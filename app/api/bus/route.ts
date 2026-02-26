import { NextResponse } from "next/server";

const BUS_URL = "https://bustime.mta.info/api/siri/stop-monitoring.json";
const OPERATOR_REF = "MTA";
const MONITORING_REF = "307688"; // B52 east/Ridgewood at Gates & Evergreen
const LINE_REF = "MTA NYCT_B52";
const MAX_VISITS = 4;

export interface BusArrival {
  route: string;
  destination?: string;
  expectedInMin: number;
}

export async function GET() {
  const key = process.env.MTA_BUS_TIME_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "MTA_BUS_TIME_KEY not configured" },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    key,
    OperatorRef: OPERATOR_REF,
    MonitoringRef: MONITORING_REF,
    LineRef: LINE_REF,
    MaximumStopVisits: String(MAX_VISITS),
  });

  try {
    const res = await fetch(`${BUS_URL}?${params.toString()}`, {
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      const status = res.status;
      const friendlyMessage =
        status === 403
          ? "Bus API key missing or invalid. Check MTA_BUS_TIME_KEY in .env.local"
          : status === 401
            ? "Bus API key invalid or expired"
            : `Bus API error: ${status}`;
      return NextResponse.json(
        { error: friendlyMessage, details: text.slice(0, 200) },
        { status: 502 }
      );
    }

    const data = await res.json();
    const arrivals = parseBusResponse(data);
    return NextResponse.json({ arrivals });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Bus fetch failed", details: message },
      { status: 502 }
    );
  }
}

function parseBusResponse(data: unknown): BusArrival[] {
  const arrivals: BusArrival[] = [];
  try {
    const siri = (data as { Siri?: { ServiceDelivery?: { StopMonitoringDelivery?: Array<{ MonitoredStopVisit?: unknown[] }> } } }).Siri;
    const delivery = siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
    const visits = delivery?.MonitoredStopVisit ?? [];

    const now = Date.now();
    for (const v of visits) {
      const visit = v as {
        MonitoredVehicleJourney?: {
          PublishedLineName?: string;
          DestinationName?: string;
          MonitoredCall?: { ExpectedArrivalTime?: string };
        };
      };
      const journey = visit.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;
      const expectedTime = call?.ExpectedArrivalTime;
      if (!expectedTime) continue;

      const expectedMs = new Date(expectedTime).getTime();
      const expectedInMin = Math.max(0, Math.round((expectedMs - now) / 60000));
      arrivals.push({
        route: journey?.PublishedLineName ?? "B52",
        destination: journey?.DestinationName,
        expectedInMin,
      });
    }
    arrivals.sort((a, b) => a.expectedInMin - b.expectedInMin);
  } catch {
    // return empty on parse error
  }
  return arrivals.slice(0, MAX_VISITS);
}
