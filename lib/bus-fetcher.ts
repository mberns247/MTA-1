import type { NormalizedArrival } from "./transit-options";

const BUS_URL = "https://bustime.mta.info/api/siri/stop-monitoring.json";

/**
 * Fetch bus arrivals for a stop/line, returning up to `limit` normalized arrivals.
 * Returns empty array if MTA_BUS_TIME_KEY is not set.
 */
export async function fetchBusArrivals(
  monitoringRef: string,
  lineRef: string,
  operatorRef: string,
  limit: number
): Promise<NormalizedArrival[]> {
  const key = process.env.MTA_BUS_TIME_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    key,
    OperatorRef: operatorRef,
    MonitoringRef: monitoringRef,
    LineRef: lineRef,
    MaximumStopVisits: String(Math.max(limit, 4)),
    StopMonitoringDetailLevel: "calls",
    MaximumNumberOfCallsOnwards: "15",
    version: "2", // SIRI v2 may include NumberOfStopsAway / more detail
  });

  try {
    const res = await fetch(`${BUS_URL}?${params.toString()}`, {
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = parseBusResponse(data);
    return raw.slice(0, limit).map((a) => ({
      route: a.route,
      destination: a.destination,
      minutes: a.expectedInMin,
      ...(a.stopsAway != null && { stopsAway: a.stopsAway }),
      ...(a.progressStatus && { progressStatus: a.progressStatus }),
    }));
  } catch {
    return [];
  }
}

interface BusArrivalRaw {
  route: string;
  destination?: string;
  expectedInMin: number;
  stopsAway?: number;
  progressStatus?: "scheduled" | "live";
}

function parseBusResponse(data: unknown): BusArrivalRaw[] {
  const arrivals: BusArrivalRaw[] = [];
  try {
    const siri = (data as {
      Siri?: {
        ServiceDelivery?: {
          StopMonitoringDelivery?: Array<{ MonitoredStopVisit?: unknown[] }>;
        };
      };
    }).Siri;
    const deliveries = siri?.ServiceDelivery?.StopMonitoringDelivery ?? [];
    // Collect visits from all delivery blocks (API can return multiple; we were only using [0])
    const allVisits: unknown[] = [];
    for (const delivery of deliveries) {
      const list = delivery?.MonitoredStopVisit ?? [];
      if (Array.isArray(list)) allVisits.push(...list);
      else allVisits.push(list);
    }

    const now = Date.now();
    for (const v of allVisits) {
      const visit = v as {
        MonitoredVehicleJourney?: {
          PublishedLineName?: string;
          DestinationName?: string;
          MonitoredCall?: {
            ExpectedArrivalTime?: string;
            expectedArrivalTime?: string;
            NumberOfStopsAway?: number;
            numberOfStopsAway?: number;
            Extensions?: { NumberOfStopsAway?: number; numberOfStopsAway?: number };
          };
          OnwardCalls?: unknown[];
          OnwardCall?: unknown | unknown[];
          onwardCalls?: unknown[];
          onwardCall?: unknown | unknown[];
          ProgressStatus?: string | { prevTrip?: boolean; layover?: boolean; [k: string]: unknown };
          progressStatus?: string | { prevTrip?: boolean; layover?: boolean; [k: string]: unknown };
        };
      };
      const journey = visit.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;
      const expectedTime = call?.ExpectedArrivalTime ?? (call as { expectedArrivalTime?: string })?.expectedArrivalTime;
      if (!expectedTime) continue;

      const expectedMs = new Date(expectedTime).getTime();
      const expectedInMin = Math.max(0, Math.round((expectedMs - now) / 60000));

      // Stops away: look for explicit value from API (multiple possible key names).
      // Do NOT use OnwardCalls length — that list can be "all stops from trip start" (wrong).
      const readStopsAway = (obj: Record<string, unknown> | null | undefined): number | undefined => {
        if (!obj || typeof obj !== "object") return undefined;
        const ext = obj.Extensions as Record<string, unknown> | undefined;
        const v =
          obj.NumberOfStopsAway ??
          obj.numberOfStopsAway ??
          obj.NumStopsAway ??
          obj.numStopsAway ??
          obj.StopsAway ??
          obj.stopsAway ??
          ext?.NumberOfStopsAway ??
          ext?.numberOfStopsAway ??
          ext?.NumStopsAway ??
          ext?.numStopsAway;
        if (typeof v === "number" && v >= 0 && v <= 100) return v;
        if (typeof v === "string") {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
        }
        // Fallback: scan all keys for anything that looks like "stops away" (e.g. odd casing)
        const scan = (o: Record<string, unknown> | undefined): number | undefined => {
          if (!o) return undefined;
          for (const [k, val] of Object.entries(o)) {
            const key = k.toLowerCase();
            if ((key.includes("stop") && key.includes("away")) || key === "numberofstopsaway" || key === "numstopsaway") {
              if (typeof val === "number" && val >= 0 && val <= 100) return val;
              if (typeof val === "string") {
                const n = parseInt(val, 10);
                if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
              }
            }
          }
          return undefined;
        };
        return scan(obj) ?? scan(ext);
      };
      let stopsAway: number | undefined = readStopsAway(call as Record<string, unknown> | undefined);
      if (stopsAway == null && journey) {
        const j = journey as Record<string, unknown>;
        const onwardCalls = j.OnwardCalls ?? j.onwardCalls;
        const onwardCall = j.OnwardCall ?? j.onwardCall;
        let list: unknown[] | undefined;
        if (Array.isArray(onwardCalls)) list = onwardCalls;
        else if (onwardCalls && typeof onwardCalls === "object" && "OnwardCall" in onwardCalls) {
          const oc = (onwardCalls as { OnwardCall: unknown }).OnwardCall;
          list = Array.isArray(oc) ? oc : oc != null ? [oc] : undefined;
        } else if (Array.isArray(onwardCall)) list = onwardCall;
        else if (onwardCall != null) list = [onwardCall];
        if (list && list.length > 0) {
          const first = list[0] as Record<string, unknown> | undefined;
          stopsAway = readStopsAway(first);
        }
      }

      // ProgressStatus: prevTrip/layover = bus on a prior trip (block assignment), not yet serving our stop → "scheduled"
      const progress = journey?.ProgressStatus ?? journey?.progressStatus;
      const hasPrevTrip =
        progress === "prevTrip" ||
        progress === "layover" ||
        (typeof progress === "object" && progress != null && (progress.prevTrip === true || progress.layover === true));
      const progressStatus: "scheduled" | "live" | undefined = hasPrevTrip
        ? "scheduled"
        : typeof stopsAway === "number" && stopsAway >= 0
          ? "live"
          : undefined;

      arrivals.push({
        route: journey?.PublishedLineName ?? "",
        destination: journey?.DestinationName,
        expectedInMin,
        ...(typeof stopsAway === "number" && stopsAway >= 0 && { stopsAway }),
        ...(progressStatus && { progressStatus }),
      });
    }
    arrivals.sort((a, b) => a.expectedInMin - b.expectedInMin);
  } catch {
    // return empty on parse error
  }
  return arrivals;
}
