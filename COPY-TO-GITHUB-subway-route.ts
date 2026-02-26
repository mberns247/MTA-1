import { NextRequest, NextResponse } from "next/server";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const GTFS_FEED_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz";
const MAX_ARRIVALS = 4;
const WINDOW_MS = 90 * 60 * 1000; // 90 minutes (look further ahead to get up to 4 arrivals)

export interface SubwayArrival {
  route: string;
  destination?: string;
  arrivalInMin: number;
  stopId: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const overrideStop = searchParams.get("stopId") || undefined; // J30N | J30S
  const envStop = process.env.SUBWAY_STOP_ID;
  const key = process.env.MTA_SUBWAY_GTFS_RT_KEY;

  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;

  // Manhattan-bound only. At Gates Av, feed J30S = Manhattan (we show as J30N), feed J30N = other direction (we show as J30S). Swap so labels match reality.
  const feedStopFor = (label: string) => (label === "J30N" ? "J30S" : "J30N");

  const requestedStop = overrideStop || envStop;
  // If user picked a platform (J30N or J30S), use it. Otherwise default to Manhattan-bound (J30N).
  const stopId = requestedStop === "J30S" ? "J30S" : "J30N";
  const feedStop = feedStopFor(stopId);
  const arrivals = await fetchArrivalsForStop(GTFS_FEED_URL, headers, feedStop);
  return NextResponse.json({ arrivals, stopId });
}

async function fetchArrivalsForStop(
  url: string,
  headers: Record<string, string>,
  stopId: string
): Promise<SubwayArrival[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 0 },
      headers: { ...headers, Accept: "application/x-protobuf" },
    });
    if (!res.ok) return [];
    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    return parseTripUpdates(feed as unknown as { entity?: FeedEntityLike[] }, stopId);
  } catch {
    return [];
  }
}

interface FeedEntityLike {
  tripUpdate?: {
    trip?: { routeId?: string; tripShortName?: string; headsign?: string };
    stopTimeUpdate?: Array<{
      stopId?: string;
      arrival?: { time?: number | { toNumber?: () => number } };
      departure?: { time?: number | { toNumber?: () => number } };
    }>;
  };
}

function parseTripUpdates(feed: { entity?: FeedEntityLike[] }, stopId: string): SubwayArrival[] {
  const arrivals: SubwayArrival[] = [];
  const now = Date.now();
  const entities = feed.entity ?? [];

  for (const entity of entities) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate?.stopTimeUpdate) continue;

    const trip = tripUpdate.trip ?? {};
    const routeId = trip.routeId ?? "J";
    const routeLabel = routeId === "J" ? "J" : routeId === "Z" ? "Z" : routeId;
    const headsign = trip.tripShortName ?? trip.headsign;

    const updates = tripUpdate.stopTimeUpdate ?? [];
    for (const stu of updates) {
      if (stu.stopId !== stopId) continue;
      const rawTime = stu.arrival?.time ?? stu.departure?.time;
      if (rawTime == null) continue;
      const timeSec = typeof rawTime === "number" ? rawTime : Number((rawTime as { toNumber?: () => number }).toNumber?.() ?? rawTime);
      const arrivalMs = timeSec * 1000;
      if (arrivalMs < now - 120000) continue; // skip past
      if (arrivalMs > now + WINDOW_MS) continue; // cap at window
      const arrivalInMin = Math.max(0, Math.round((arrivalMs - now) / 60000));
      arrivals.push({
        route: routeLabel,
        destination: headsign ?? undefined,
        arrivalInMin,
        stopId,
      });
    }
  }

  arrivals.sort((a, b) => a.arrivalInMin - b.arrivalInMin);
  return arrivals.slice(0, MAX_ARRIVALS);
}
