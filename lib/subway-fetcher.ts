import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { getSubwayFeedUrl } from "./transit-options";
import type { NormalizedArrival } from "./transit-options";
import subwayDestinations from "@/data/subway-destinations.json";
import subwayStopNames from "@/data/subway-stop-names.json";

const WINDOW_MS = 90 * 60 * 1000; // 90 minutes

/** feedId -> directionId ("0"|"1") -> destination name (fallback when last stop unknown) */
const DESTINATIONS_BY_FEED = subwayDestinations as Record<string, Record<string, string>>;

/** stop_id -> stop_name for showing destination (last stop in trip's stopTimeUpdate) */
const STOP_NAMES = subwayStopNames as Record<string, string>;

/** When trip.routeId is missing in the feed, use this per-feed default for the display label. */
const FEED_DEFAULT_ROUTE: Record<string, string> = {
  "1234567": "1",
  ace: "A",
  bdfm: "B",
  g: "G",
  jz: "J",
  l: "L",
  nqrw: "N",
  sir: "S",
};

interface FeedEntityLike {
  tripUpdate?: {
    trip?: {
      routeId?: string;
      tripShortName?: string;
      headsign?: string;
      directionId?: number;
    };
    stopTimeUpdate?: Array<{
      stopId?: string;
      arrival?: { time?: number | { toNumber?: () => number } };
      departure?: { time?: number | { toNumber?: () => number } };
    }>;
  };
}

/** Decoded GTFS-RT feed (entity list) for reuse across multiple stops. */
export type DecodedSubwayFeed = { entity?: FeedEntityLike[] };

/**
 * Fetch and decode a subway GTFS-RT feed once. Returns null on any failure (e.g. 401, 429, network).
 * Callers should use parseSubwayArrivalsFromFeed with the result for each stop/direction.
 */
export async function fetchSubwayFeed(feedId: string): Promise<DecodedSubwayFeed | null> {
  const url = getSubwayFeedUrl(feedId);
  const key = process.env.MTA_SUBWAY_GTFS_RT_KEY;
  const headers: Record<string, string> = { Accept: "application/x-protobuf" };
  if (key) headers["x-api-key"] = key;

  try {
    const res = await fetch(url, {
      next: { revalidate: 0 },
      headers,
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    return feed as unknown as DecodedSubwayFeed;
  } catch {
    return null;
  }
}

/**
 * Parse arrivals for one stop/direction from an already-decoded feed.
 * Use after fetchSubwayFeed to avoid fetching the same feed multiple times.
 */
export function parseSubwayArrivalsFromFeed(
  feed: DecodedSubwayFeed,
  feedStopId: string,
  feedId: string,
  slotDirectionId: string | undefined,
  limit: number
): NormalizedArrival[] {
  const raw = parseTripUpdates(feed, feedStopId, feedId, slotDirectionId);
  return raw.slice(0, limit).map((a) => ({
    route: a.route,
    destination: a.destination,
    minutes: a.arrivalInMin,
  }));
}

/**
 * Fetch subway arrivals for a given feed and stop, returning up to `limit` normalized arrivals.
 * Prefer using fetchSubwayFeed + parseSubwayArrivalsFromFeed in the API route to deduplicate feed fetches.
 * @param slotDirectionId - "0" or "1" from the selected option; used when the feed doesn't provide per-trip direction/destination.
 */
export async function fetchSubwayArrivals(
  feedId: string,
  feedStopId: string,
  limit: number,
  slotDirectionId?: string
): Promise<NormalizedArrival[]> {
  const feed = await fetchSubwayFeed(feedId);
  if (!feed) return [];
  return parseSubwayArrivalsFromFeed(feed, feedStopId, feedId, slotDirectionId, limit);
}

interface SubwayArrivalRaw {
  route: string;
  destination?: string;
  arrivalInMin: number;
  stopId: string;
}

/** Normalize trip.directionId from feed (may be number or protobuf Long) to "0" | "1" for comparison. */
function normalizeDirectionId(value: number | { toNumber?: () => number } | undefined): string | undefined {
  if (value === undefined) return undefined;
  const num = typeof value === "number" ? value : Number((value as { toNumber?: () => number }).toNumber?.() ?? value);
  if (Number.isNaN(num)) return undefined;
  return String(num);
}

/** True if the feed's stop_id matches our option stop (exact, or parent/platform cross-match). */
function stopIdMatches(feedStopId: string | null | undefined, ourStopId: string): boolean {
  if (!feedStopId) return false;
  if (feedStopId === ourStopId) return true;
  const ourLast = ourStopId.slice(-1);
  // Feed sends parent (e.g. 627), we have platform (627N/627S)
  if ((ourLast === "N" || ourLast === "S") && feedStopId === ourStopId.slice(0, -1)) return true;
  // Feed sends platform (627N/627S), we have parent (627) — e.g. if static GTFS used parent in stop_times
  const feedLast = feedStopId.slice(-1);
  if ((feedLast === "N" || feedLast === "S") && ourStopId === feedStopId.slice(0, -1)) return true;
  return false;
}

function parseTripUpdates(
  feed: DecodedSubwayFeed,
  stopId: string,
  feedId: string,
  slotDirectionId?: string
): SubwayArrivalRaw[] {
  const arrivals: SubwayArrivalRaw[] = [];
  const now = Date.now();
  const entities = feed.entity ?? [];
  const feedDestinations = DESTINATIONS_BY_FEED[feedId];

  for (const entity of entities) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate?.stopTimeUpdate) continue;

    const trip = tripUpdate.trip ?? {};
    const routeId = trip.routeId ?? FEED_DEFAULT_ROUTE[feedId] ?? "?";
    const routeLabel = routeId;
    const updates = tripUpdate.stopTimeUpdate ?? [];
    // Destination = name of last stop in this trip's stop list (the terminal)
    const lastStopUpdate = updates.length > 0 ? updates[updates.length - 1] : null;
    const lastStopId = lastStopUpdate?.stopId;
    const destinationFromLastStop =
      lastStopId && STOP_NAMES[lastStopId] ? STOP_NAMES[lastStopId] : undefined;
    const tripDirectionStr = normalizeDirectionId(trip.directionId);
    const directionKey = tripDirectionStr ?? slotDirectionId;
    const staticDestination =
      feedDestinations && directionKey
        ? feedDestinations[directionKey]
        : undefined;
    const destination = destinationFromLastStop || staticDestination || undefined;

    for (const stu of updates) {
      if (!stopIdMatches(stu.stopId, stopId)) continue;
      if (slotDirectionId != null && tripDirectionStr !== undefined && tripDirectionStr !== slotDirectionId) continue;
      const rawTime = stu.arrival?.time ?? stu.departure?.time;
      if (rawTime == null) continue;
      const timeSec =
        typeof rawTime === "number"
          ? rawTime
          : Number((rawTime as { toNumber?: () => number }).toNumber?.() ?? rawTime);
      const arrivalMs = timeSec * 1000;
      if (arrivalMs < now - 120000) continue;
      if (arrivalMs > now + WINDOW_MS) continue;
      const arrivalInMin = Math.max(0, Math.round((arrivalMs - now) / 60000));
      arrivals.push({
        route: routeLabel,
        destination,
        arrivalInMin,
        stopId,
      });
    }
  }

  arrivals.sort((a, b) => a.arrivalInMin - b.arrivalInMin);
  return arrivals;
}
