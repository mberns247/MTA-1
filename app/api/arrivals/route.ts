import { NextRequest, NextResponse } from "next/server";
import {
  getOption,
  getOptionIdsForSlot,
  MIN_SLOTS,
  MAX_SLOTS,
  MIN_ARRIVALS,
  MAX_ARRIVALS,
  type SlotConfig,
  type NormalizedArrival,
  type SubwayOption,
} from "@/lib/transit-options";
import { fetchSubwayFeed, parseSubwayArrivalsFromFeed } from "@/lib/subway-fetcher";
import { fetchBusArrivals } from "@/lib/bus-fetcher";
import { fetchAlerts, matchAlertsForOption } from "@/lib/alerts-fetcher";

export interface ArrivalsResultItem {
  optionId: string;
  label: string;
  type: "subway" | "bus";
  arrivals: NormalizedArrival[];
  /** Alerts that apply to this stop/line (e.g. for alert icon + modal). */
  alerts?: { header: string; description: string }[];
  error?: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const slotsParam = searchParams.get("slots");

  if (!slotsParam) {
    return NextResponse.json(
      { error: "Missing slots query parameter (JSON array of { type, optionId, maxArrivals })" },
      { status: 400 }
    );
  }

  let slots: SlotConfig[];
  try {
    slots = JSON.parse(decodeURIComponent(slotsParam)) as SlotConfig[];
  } catch {
    return NextResponse.json({ error: "Invalid slots JSON" }, { status: 400 });
  }

  if (!Array.isArray(slots) || slots.length < MIN_SLOTS || slots.length > MAX_SLOTS) {
    return NextResponse.json(
      { error: `slots must be an array of length ${MIN_SLOTS} to ${MAX_SLOTS}` },
      { status: 400 }
    );
  }

  const busKeyMissing = !process.env.MTA_BUS_TIME_KEY;

  let allAlerts: Awaited<ReturnType<typeof fetchAlerts>> = [];
  try {
    allAlerts = await fetchAlerts();
  } catch {
    // non-fatal; continue without alerts
  }

  const results: ArrivalsResultItem[] = new Array(slots.length);

  // Collect unique feedIds from subway slots so we fetch each feed once
  const feedIds = new Set<string>();
  for (let i = 0; i < slots.length; i++) {
    const option = getOption(slots[i].optionId);
    if (option?.type === "subway") {
      feedIds.add((option as SubwayOption).feedId);
    }
  }

  const feedCache = new Map<string, Awaited<ReturnType<typeof fetchSubwayFeed>>>();
  for (const feedId of Array.from(feedIds)) {
    feedCache.set(feedId, await fetchSubwayFeed(feedId));
  }

  const subwayFeedError = "Subway feed temporarily unavailable";

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ids = getOptionIdsForSlot(slot);
    const option = getOption(slot.optionId);
    if (!option) {
      results[i] = {
        optionId: slot.optionId,
        label: slot.optionId,
        type: slot.type,
        arrivals: [],
        error: "Unknown option",
      };
      continue;
    }

    const maxArrivals = Math.min(
      MAX_ARRIVALS,
      Math.max(MIN_ARRIVALS, typeof slot.maxArrivals === "number" ? slot.maxArrivals : 4)
    );

    if (option.type === "subway") {
      const feedId = (option as SubwayOption).feedId;
      const feed = feedCache.get(feedId) ?? null;
      if (!feed) {
        results[i] = {
          optionId: slot.optionId,
          label: option.label,
          type: "subway",
          arrivals: [],
          error: subwayFeedError,
        };
        continue;
      }
      const allArrivals = ids.flatMap((id) => {
        const opt = getOption(id) as SubwayOption | undefined;
        if (!opt || opt.type !== "subway") return [];
        const dirId = opt.directionId ?? opt.id.split("-").pop();
        let arrivals = parseSubwayArrivalsFromFeed(
          feed,
          opt.feedStopId,
          opt.feedId,
          dirId,
          maxArrivals * 2
        );
        // If direction filter yields nothing, MTA RT feed may use opposite direction_id convention. Try inverted.
        if (arrivals.length === 0 && (dirId === "0" || dirId === "1")) {
          const fallbackDir = dirId === "0" ? "1" : "0";
          arrivals = parseSubwayArrivalsFromFeed(feed, opt.feedStopId, opt.feedId, fallbackDir, maxArrivals * 2);
        }
        return arrivals;
      });
      const merged = allArrivals.sort((a, b) => a.minutes - b.minutes);
      const arrivals = merged.slice(0, maxArrivals);
      const firstOpt = getOption(ids[0]) as SubwayOption | undefined;
      const label =
        firstOpt && firstOpt.type === "subway"
          ? ids.length > 1
            ? `${firstOpt.stopLabel} · ${firstOpt.directionId === "1" ? "Downtown" : "Uptown"}`
            : firstOpt.label
          : slot.optionId;
      const alertsForSlot = new Map<string, { header: string; description: string }>();
      for (const id of ids) {
        const opt = getOption(id);
        if (!opt) continue;
        for (const a of matchAlertsForOption(opt, allAlerts)) {
          alertsForSlot.set(`${a.header}\n${a.description}`, { header: a.header, description: a.description });
        }
      }
      results[i] = {
        optionId: slot.optionId,
        label,
        type: "subway",
        arrivals,
        alerts: alertsForSlot.size ? Array.from(alertsForSlot.values()) : undefined,
      };
      continue;
    }

    // bus (single option)
    if (busKeyMissing) {
      results[i] = {
        optionId: option.id,
        label: option.label,
        type: "bus",
        arrivals: [],
        error: "MTA_BUS_TIME_KEY not configured",
      };
      continue;
    }
    const arrivals = await fetchBusArrivals(
      option.monitoringRef,
      option.lineRef,
      option.operatorRef,
      maxArrivals
    );
    const busAlerts = matchAlertsForOption(option, allAlerts);
    results[i] = {
      optionId: option.id,
      label: option.label,
      type: "bus",
      arrivals,
      alerts: busAlerts.length ? busAlerts.map((a) => ({ header: a.header, description: a.description })) : undefined,
    };
  }

  return NextResponse.json({ results });
}
