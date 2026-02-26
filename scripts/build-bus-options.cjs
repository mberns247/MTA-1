/**
 * Builds data/bus-options.json from MTA Bus GTFS (all 6 borough/company zips).
 * Run: node scripts/build-bus-options.cjs
 * Uses: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_*.zip
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { parse } = require("csv-parse/sync");
const AdmZip = require("adm-zip");

const BUS_GTFS_URLS = [
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip",   // Brooklyn
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_bx.zip",  // Bronx
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip",   // Manhattan
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_q.zip",   // Queens
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_si.zip",  // Staten Island
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_busco.zip", // Bus Company
];

const OUT_PATH = path.join(__dirname, "..", "data", "bus-options.json");

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`${url} HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (ch) => chunks.push(ch));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseCsv(buf) {
  return parse(buf.toString("utf-8"), { columns: true, skip_empty_lines: true });
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function processZip(url) {
  const zipBuf = await download(url);
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries();

  const getText = (name) => {
    const e = entries.find((x) => x.entryName.endsWith(name));
    return e ? e.getData().toString("utf-8") : null;
  };

  const stopsRaw = getText("stops.txt");
  const routesRaw = getText("routes.txt");
  const tripsRaw = getText("trips.txt");
  const stopTimesRaw = getText("stop_times.txt");

  if (!stopsRaw || !routesRaw || !tripsRaw || !stopTimesRaw) return [];

  const stops = parseCsv(Buffer.from(stopsRaw));
  const routes = parseCsv(Buffer.from(routesRaw));
  const trips = parseCsv(Buffer.from(tripsRaw));
  const stopTimes = parseCsv(Buffer.from(stopTimesRaw));

  const stopById = new Map();
  for (const s of stops) {
    stopById.set(s.stop_id, s.stop_name || s.stop_id);
  }

  const routeById = new Map();
  for (const r of routes) {
    const short = (r.route_short_name || r.route_id || "").trim();
    routeById.set(r.route_id, short);
  }

  const tripToRouteAndHeadsign = new Map();
  for (const t of trips) {
    const routeShort = routeById.get(t.route_id) || t.route_id;
    const headsign = (t.trip_headsign || "").trim() || null;
    tripToRouteAndHeadsign.set(t.trip_id, { routeShort, routeId: t.route_id, headsign });
  }

  // stop_id -> Map(route_id -> { routeShort, headsign }) so we get one destination per (stop, route) direction
  const stopRouteInfo = new Map();
  for (const st of stopTimes) {
    const info = tripToRouteAndHeadsign.get(st.trip_id);
    if (!info) continue;
    if (!stopRouteInfo.has(st.stop_id)) stopRouteInfo.set(st.stop_id, new Map());
    const byRoute = stopRouteInfo.get(st.stop_id);
    const key = info.routeId;
    if (!byRoute.has(key)) byRoute.set(key, { routeShort: info.routeShort, headsign: info.headsign });
  }

  const options = [];
  for (const [stopId, byRoute] of stopRouteInfo) {
    const stopName = stopById.get(stopId) || stopId;
    for (const [, { routeShort, headsign }] of byRoute) {
      const lineRef = `MTA NYCT_${routeShort}`;
      const id = `bus-${slug(stopId)}-${slug(routeShort)}`;
      const destinationLabel = headsign || null;
      options.push({
        id,
        type: "bus",
        label: `${routeShort} · ${stopName}`,
        stopLabel: stopName,
        directionLabel: `${routeShort}`,
        ...(destinationLabel && { destinationLabel }),
        monitoringRef: stopId,
        lineRef,
        operatorRef: "MTA",
      });
    }
  }
  return options;
}

async function main() {
  let all = [];
  for (const url of BUS_GTFS_URLS) {
    process.stdout.write(`Fetching ${url.split("/").pop()}... `);
    try {
      const options = await processZip(url);
      all = all.concat(options);
      console.log(`${options.length} options`);
    } catch (err) {
      console.log("failed:", err.message);
    }
  }

  const seen = new Set();
  const unique = all.filter((o) => {
    const key = `${o.monitoringRef}|${o.lineRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => {
    const c = a.stopLabel.localeCompare(b.stopLabel);
    return c !== 0 ? c : a.directionLabel.localeCompare(b.directionLabel);
  });

  const outDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(unique, null, 2), "utf-8");
  console.log(`Wrote ${unique.length} bus options to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
