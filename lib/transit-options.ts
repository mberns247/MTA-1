/**
 * Transit options for the multi-line dashboard.
 * Subway: loaded from data/subway-options.json (generated from MTA GTFS via scripts/build-subway-options.cjs).
 * Bus: curated list; expand via bus GTFS or Bus Time API for full coverage.
 */

import subwayOptionsData from "@/data/subway-options.json";
import busOptionsData from "@/data/bus-options.json";
import subwayDestinationsData from "@/data/subway-destinations.json";
import destinationBoroughData from "@/data/destination-borough.json";

export type SlotType = "subway" | "bus";

export interface SlotConfig {
  type: SlotType;
  optionId: string;
  maxArrivals: number; // 1-4
  /** For subway: when station has shared platforms, multiple optionIds are fetched and merged. Derived on load if missing. */
  optionIds?: string[];
}

/** Normalized arrival shape for display (subway and bus). */
export interface NormalizedArrival {
  route: string;
  destination?: string;
  minutes: number;
  /** Bus only: number of stops before this one (from SIRI). */
  stopsAway?: number;
  /** Bus only: "scheduled" when bus is on a prior trip (ProgressStatus prevTrip/layover); "live" when actively en route. */
  progressStatus?: "scheduled" | "live";
}

/** Subway option: feed + stop + direction. */
export interface SubwayOption {
  id: string;
  type: "subway";
  label: string;
  stopLabel: string;
  directionLabel: string;
  /** "0" = Uptown/Northbound, "1" = Downtown/Southbound; used for destination lookup. */
  directionId: string;
  feedId: string;
  feedStopId: string;
  stopId: string;
  /** Routes that actually serve this stop (e.g. ["M", "F"]), from GTFS. Used for platform label. */
  routes?: string[];
}

/** Bus option: SIRI stop-monitoring params. */
export interface BusOption {
  id: string;
  type: "bus";
  label: string;
  stopLabel: string;
  directionLabel: string;
  /** Destination/headsign from GTFS (e.g. "Jamaica", "Downtown") so user knows which way the bus goes. */
  destinationLabel?: string | null;
  monitoringRef: string;
  lineRef: string;
  operatorRef: string;
}

export type TransitOption = SubwayOption | BusOption;

const GTFS_FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-";

const SUBWAY_OPTIONS: SubwayOption[] = subwayOptionsData as SubwayOption[];

const BUS_OPTIONS: BusOption[] = busOptionsData as BusOption[];

export const TRANSIT_OPTIONS: TransitOption[] = [...SUBWAY_OPTIONS, ...BUS_OPTIONS];

const OPTIONS_BY_ID = new Map<string, TransitOption>(
  TRANSIT_OPTIONS.map((o) => [o.id, o])
);

/** feedId -> directionId -> destination (from GTFS trip_headsign). Used to group platforms by destination. */
const FEED_DESTINATIONS = subwayDestinationsData as Record<string, Record<string, string>>;

function getDestinationForOption(option: SubwayOption): string {
  return (
    FEED_DESTINATIONS[option.feedId]?.[option.directionId] ??
    option.directionLabel ??
    ""
  );
}

const DESTINATION_BOROUGH = destinationBoroughData as Record<string, string>;
const BOROUGH_KEYS = Object.keys(DESTINATION_BOROUGH).sort(
  (a, b) => b.length - a.length
);

function getBoroughForDestination(destination: string): string | undefined {
  if (!destination.trim()) return undefined;
  const d = destination.trim();
  for (const key of BOROUGH_KEYS) {
    if (d.toLowerCase().includes(key.toLowerCase())) return DESTINATION_BOROUGH[key];
  }
  return undefined;
}

export function getOption(id: string): TransitOption | undefined {
  return OPTIONS_BY_ID.get(id);
}

export function getSubwayOptions(): SubwayOption[] {
  return SUBWAY_OPTIONS;
}

export function getBusOptions(): BusOption[] {
  return BUS_OPTIONS;
}

export function getOptionsByType(type: SlotType): TransitOption[] {
  return type === "subway" ? [...SUBWAY_OPTIONS] : [...BUS_OPTIONS];
}

/** One platform choice in the dropdown: either a single option or multiple (merged) options. */
export interface SubwayPlatformChoice {
  label: string;
  optionIds: string[];
}

/** Short label for feed (e.g. "BDFM", "ACE") for platform dropdown. */
const SUBWAY_FEED_LABEL: Record<string, string> = {
  "1234567": "1/2/3/4/5/6/7",
  ace: "ACE",
  bdfm: "BDFM",
  g: "G",
  jz: "JZ",
  l: "L",
  nqrw: "NQRW",
  sir: "SIR",
};

/** Unique station names (stopLabel) for subway, sorted. Use for Station dropdown. */
export function getSubwayStations(): string[] {
  const set = new Set<string>();
  for (const o of SUBWAY_OPTIONS) {
    set.add(o.stopLabel);
  }
  return Array.from(set).sort();
}

/**
 * Subway platform choices at a given station.
 * Group by (feedStopId, destination) so each choice is one direction; we only merge when same stop and same destination (e.g. J and Z to Jamaica).
 */
export function getPlatformsAtStation(stationName: string): SubwayPlatformChoice[] {
  const norm = normalizeStopLabel(stationName);
  const options = SUBWAY_OPTIONS.filter((o) => normalizeStopLabel(o.stopLabel) === norm);
  if (options.length === 0) return [];

  const byPlatform = new Map<string, SubwayOption[]>();
  for (const o of options) {
    const key = `${o.feedStopId}|${getDestinationForOption(o)}`;
    if (!byPlatform.has(key)) byPlatform.set(key, []);
    byPlatform.get(key)!.push(o);
  }

  const choices: SubwayPlatformChoice[] = [];
  for (const [, opts] of Array.from(byPlatform.entries())) {
    const optionIds = opts.map((o: SubwayOption) => o.id);
    const label =
      opts.length > 1 ? `To ${getDestinationForOption(opts[0])}` : getSubwayPlatformLabel(opts[0]);
    choices.push({ label, optionIds });
  }
  choices.sort((a, b) => {
    const optA = a.optionIds[0] ? (getOption(a.optionIds[0]) as SubwayOption) : null;
    const optB = b.optionIds[0] ? (getOption(b.optionIds[0]) as SubwayOption) : null;
    const lineA = optA?.routes?.length ? optA.routes.join("/") : (optA ? SUBWAY_FEED_LABEL[optA.feedId] ?? optA.feedId : "");
    const lineB = optB?.routes?.length ? optB.routes.join("/") : (optB ? SUBWAY_FEED_LABEL[optB.feedId] ?? optB.feedId : "");
    const byLine = (lineA || "").localeCompare(lineB || "");
    if (byLine !== 0) return byLine;
    const dirA = optA?.directionId ?? "";
    const dirB = optB?.directionId ?? "";
    return dirA.localeCompare(dirB);
  });
  return choices;
}

/** Resolve optionIds for a slot (for API request). Same station + same feedStopId + same destination = same platform. */
function getOptionIdsForSlot(slot: SlotConfig): string[] {
  if (slot.type !== "subway") return [slot.optionId];
  if (slot.optionIds && slot.optionIds.length > 0) return slot.optionIds;
  const option = getOption(slot.optionId) as SubwayOption | undefined;
  if (!option || option.type !== "subway") return [slot.optionId];
  const norm = normalizeStopLabel(option.stopLabel);
  const dest = getDestinationForOption(option);
  const onSamePlatform = SUBWAY_OPTIONS.filter(
    (o) =>
      normalizeStopLabel(o.stopLabel) === norm &&
      o.feedStopId === option.feedStopId &&
      getDestinationForOption(o) === dest
  );
  return onSamePlatform.map((o) => o.id);
}

/** Platform label for subway option: "2/3/4/5 Uptown & Queens" or "B Downtown & Brooklyn" (line first, then direction & borough when known). */
export function getSubwayPlatformLabel(option: SubwayOption): string {
  const dir = option.directionId === "1" ? "Downtown" : "Uptown";
  const lineLabel =
    option.routes && option.routes.length > 0
      ? option.routes.join("/")
      : SUBWAY_FEED_LABEL[option.feedId] ?? option.feedId.toUpperCase();
  const dest = getDestinationForOption(option);
  const borough = getBoroughForDestination(dest);
  if (borough) return `${lineLabel} ${dir} & ${borough}`;
  return `${lineLabel} ${dir}`;
}

/** Just the direction part for a subway option: "Downtown & Brooklyn" or "Uptown" (no line name). */
function getSubwayDirectionOnlyLabel(option: SubwayOption): string {
  const full = getSubwayPlatformLabel(option);
  const match = full.match(/(Uptown|Downtown)(?:\s+&\s+.+)?$/);
  return match ? match[0] : full;
}

/** Line label for header: "J/Z" or "M" from routes or feed. */
export function getSubwayLineLabel(option: SubwayOption): string {
  return option.routes?.length
    ? option.routes.join("/")
    : SUBWAY_FEED_LABEL[option.feedId] ?? option.feedId.toUpperCase();
}

/** Destination for subway header after arrow: borough (e.g. Manhattan) or destination name. */
export function getSubwayHeaderDestination(option: SubwayOption): string {
  const dest = getDestinationForOption(option);
  const borough = getBoroughForDestination(dest);
  return borough || dest || "";
}

/** Unique stop names for the Stop dropdown, for a given type. */
export function getStopsByType(type: SlotType): string[] {
  const options = getOptionsByType(type);
  const stops = new Set<string>();
  for (const o of options) {
    stops.add(o.stopLabel);
  }
  return Array.from(stops).sort();
}

/** Normalize stop label for matching (trim, collapse spaces, lowercase). */
export function normalizeStopLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Options (directions) at a given stop for the Direction dropdown. */
export function getDirectionsForStop(type: SlotType, stopLabel: string): TransitOption[] {
  return getOptionsByType(type).filter((o) => o.stopLabel === stopLabel);
}

/** Like getDirectionsForStop but matches by normalized stop label so variants (casing, spacing) are grouped. */
export function getDirectionsForStopNormalized(type: SlotType, stopLabel: string): TransitOption[] {
  const norm = normalizeStopLabel(stopLabel);
  return getOptionsByType(type).filter((o) => normalizeStopLabel(o.stopLabel) === norm);
}

/** Get optionId from type + stop + direction (directionLabel). */
export function getOptionIdByStopAndDirection(
  type: SlotType,
  stopLabel: string,
  directionLabel: string
): string | undefined {
  const option = getDirectionsForStop(type, stopLabel).find(
    (o) => o.directionLabel === directionLabel
  );
  return option?.id;
}

/** MTA GTFS-RT feed URL for a feed id (e.g. jz, ace, bdfm). 1/2/3/4/5/6/7 use nyct/gtfs with no suffix. SIR uses nyct/gtfs-si (not gtfs-sir). */
export function getSubwayFeedUrl(feedId: string): string {
  if (feedId === "1234567") {
    return "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";
  }
  if (feedId === "sir") {
    return `${GTFS_FEED_BASE}si`;
  }
  return `${GTFS_FEED_BASE}${encodeURIComponent(feedId)}`;
}

export const MIN_SLOTS = 1;
export const MAX_SLOTS = 4;
export const MIN_ARRIVALS = 1;
export const MAX_ARRIVALS = 4;

export { getOptionIdsForSlot, getSubwayDirectionOnlyLabel };
