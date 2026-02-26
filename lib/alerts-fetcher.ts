import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { TransitOption } from "./transit-options";

const ALERTS_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys/all-alerts";

export interface ParsedAlert {
  header: string;
  description: string;
  /** Route IDs mentioned in informed_entity (e.g. "J", "Z", "B52"). */
  routeIds: string[];
  /** Stop IDs mentioned in informed_entity. */
  stopIds: string[];
}

function getTranslatedText(
  ts:
    | { translation?: Array<{ text?: string }> | null }
    | null
    | undefined
): string {
  const tr = ts?.translation;
  if (!tr?.length) return "";
  return (tr[0] as { text?: string })?.text ?? "";
}

function toSec(v: number | { toNumber?: () => number } | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof (v as { toNumber?: () => number }).toNumber === "function") return (v as { toNumber(): number }).toNumber();
  return 0;
}

function isAlertActive(
  activePeriod:
    | { start?: number | { toNumber?: () => number } | null; end?: number | { toNumber?: () => number } | null }[]
    | null
    | undefined,
  nowMs: number
): boolean {
  if (!activePeriod?.length) return true;
  const nowSec = Math.floor(nowMs / 1000);
  return activePeriod.some((p) => {
    const s = toSec(p.start);
    const e = p.end != null ? toSec(p.end) : Number.MAX_SAFE_INTEGER;
    return nowSec >= s && nowSec <= e;
  });
}

/**
 * Fetch and parse MTA all-alerts GTFS-RT feed. Returns alerts that are currently active.
 */
export async function fetchAlerts(): Promise<ParsedAlert[]> {
  const key = process.env.MTA_SUBWAY_GTFS_RT_KEY;
  const headers: Record<string, string> = { Accept: "application/x-protobuf" };
  if (key) headers["x-api-key"] = key;

  const res = await fetch(ALERTS_URL, {
    next: { revalidate: 0 },
    headers,
  });
  if (!res.ok) return [];
  const buffer = await res.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );
  const nowMs = Date.now();
  const out: ParsedAlert[] = [];

  for (const entity of feed.entity ?? []) {
    const alert = entity.alert;
    if (!alert) continue;
    if (!isAlertActive(alert.activePeriod, nowMs)) continue;

    const header = getTranslatedText(alert.headerText);
    const description = getTranslatedText(alert.descriptionText);
    const routeIds: string[] = [];
    const stopIds: string[] = [];
    for (const sel of alert.informedEntity ?? []) {
      const r = (sel as { routeId?: string }).routeId;
      const s = (sel as { stopId?: string }).stopId;
      if (r) routeIds.push(r);
      if (s) stopIds.push(s);
    }
    // Dedupe
    const routeSet = new Set(routeIds);
    const stopSet = new Set(stopIds);
    out.push({
      header: header || "Service alert",
      description,
routeIds: Array.from(routeSet),
    stopIds: Array.from(stopSet),
    });
  }
  return out;
}

/**
 * Return alerts that apply to the given transit option (by route_id or stop_id).
 */
export function matchAlertsForOption(
  option: TransitOption,
  alerts: ParsedAlert[]
): ParsedAlert[] {
  if (option.type === "subway") {
    const routeSet = new Set(option.routes ?? []);
    const stopId = option.feedStopId;
    return alerts.filter(
      (a) =>
        a.routeIds.some((r) => routeSet.has(r)) ||
        (stopId && a.stopIds.includes(stopId))
    );
  }
  // Bus: match by lineRef or the short form (e.g. M15 from MTA NYCT_M15)
  const lineRef = option.lineRef;
  const shortLine = lineRef.includes("_") ? lineRef.split("_").pop()! : lineRef;
  return alerts.filter((a) =>
    a.routeIds.some(
      (r) => r === lineRef || r === shortLine || lineRef.endsWith("_" + r)
    )
  );
}
