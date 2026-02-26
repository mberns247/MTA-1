/**
 * MTA subway line colors (official / standard). Bus lines use a single blue.
 * https://new.mta.info/developers
 */
const SUBWAY_LINE_COLORS: Record<string, string> = {
  A: "#0039A6",
  C: "#0039A6",
  E: "#0039A6",
  B: "#FF6319",
  D: "#FF6319",
  F: "#FF6319",
  M: "#FF6319",
  G: "#6CBE45",
  J: "#996600",
  Z: "#996600",
  L: "#A7A9AC",
  N: "#FCCC0A",
  Q: "#FCCC0A",
  R: "#FCCC0A",
  W: "#FCCC0A",
  "1": "#EE352E",
  "2": "#EE352E",
  "3": "#EE352E",
  "4": "#00933C",
  "5": "#00933C",
  "6": "#00933C",
  "7": "#B933AD",
  S: "#808183",
};

const BUS_BADGE_COLOR = "#0284c7";

/** Background color for a line badge. Subway: by route letter/number; bus: blue. */
export function getLineBadgeColor(route: string, isSubway: boolean): string {
  if (!isSubway) return BUS_BADGE_COLOR;
  const r = route.trim().toUpperCase();
  return SUBWAY_LINE_COLORS[r] ?? "#996600"; // default to J/Z brown for unknown
}
