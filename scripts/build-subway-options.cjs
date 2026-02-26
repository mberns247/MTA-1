/**
 * Builds data/subway-options.json from MTA GTFS static.
 * Run: node scripts/build-subway-options.cjs
 * Requires: npm install adm-zip csv-parse
 * Uses: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { parse } = require("csv-parse/sync");
const AdmZip = require("adm-zip");

const GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip";
const OUT_PATH = path.join(__dirname, "..", "data", "subway-options.json");
const DESTINATIONS_OUT_PATH = path.join(__dirname, "..", "data", "subway-destinations.json");
const STOP_NAMES_OUT_PATH = path.join(__dirname, "..", "data", "subway-stop-names.json");

// MTA GTFS-RT feed IDs by route short name (from api.mta.info)
const ROUTE_TO_FEED = {
  "1": "1234567", "2": "1234567", "3": "1234567", "4": "1234567",
  "5": "1234567", "6": "1234567", "7": "1234567",
  A: "ace", C: "ace", E: "ace",
  B: "bdfm", D: "bdfm", F: "bdfm", M: "bdfm",
  G: "g",
  J: "jz", Z: "jz",
  L: "l",
  N: "nqrw", Q: "nqrw", R: "nqrw", W: "nqrw",
  S: "sir", // SI Railway / shuttles; may not have RT feed
};

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
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

function main() {
  console.log("Downloading GTFS...");
  download(GTFS_URL)
    .then((zipBuf) => {
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

      if (!stopsRaw || !routesRaw || !tripsRaw || !stopTimesRaw) {
        throw new Error("Missing required GTFS files in zip");
      }

      const stops = parseCsv(Buffer.from(stopsRaw));
      const routes = parseCsv(Buffer.from(routesRaw));
      const trips = parseCsv(Buffer.from(tripsRaw));
      const stopTimes = parseCsv(Buffer.from(stopTimesRaw));

      const stopById = new Map();
      for (const s of stops) {
        stopById.set(s.stop_id, { stop_name: s.stop_name || s.stop_id, parent_station: s.parent_station });
      }

      const routeById = new Map();
      for (const r of routes) {
        routeById.set(r.route_id, (r.route_short_name || r.route_id || "").trim().toUpperCase());
      }

      const tripToRoute = new Map();
      const tripToDirection = new Map();
      for (const t of trips) {
        tripToRoute.set(t.trip_id, routeById.get(t.route_id) || t.route_id);
        tripToDirection.set(t.trip_id, t.direction_id === undefined ? "0" : t.direction_id);
      }

      // feedId -> directionId -> destination (trip_headsign from static GTFS)
      const feedDestinations = {};
      for (const t of trips) {
        const routeShort = routeById.get(t.route_id) || t.route_id;
        const feedId = ROUTE_TO_FEED[routeShort];
        if (!feedId) continue;
        const dir = t.direction_id === undefined ? "0" : String(t.direction_id);
        const headsign = (t.trip_headsign || "").trim();
        if (!headsign) continue;
        if (!feedDestinations[feedId]) feedDestinations[feedId] = {};
        if (!feedDestinations[feedId][dir]) feedDestinations[feedId][dir] = headsign;
      }

      // (stop_id, feedId, directionId) -> Set of route short names that actually serve this stop
      const stopOptionRoutes = new Map();
      for (const st of stopTimes) {
        const route = tripToRoute.get(st.trip_id);
        const dir = tripToDirection.get(st.trip_id);
        if (!route) continue;
        const feedId = ROUTE_TO_FEED[route];
        if (!feedId) continue;
        const key = `${st.stop_id}|${feedId}|${dir}`;
        if (!stopOptionRoutes.has(key)) stopOptionRoutes.set(key, new Set());
        stopOptionRoutes.get(key).add(route);
      }

      const options = [];
      const seen = new Set();

      for (const [key, routeSet] of stopOptionRoutes) {
        const [stopId, feedId, directionId] = key.split("|");
        const routes = Array.from(routeSet).sort();
        const stopInfo = stopById.get(stopId);
        const stopName = (stopInfo && stopInfo.stop_name) || stopId;
        const dirLabel = directionId === "1" ? "Southbound" : "Northbound";
        const routeLabel = routes.length > 0 ? routes.join("/") : (feedId === "1234567" ? "1/2/3/4/5/6/7" : feedId.toUpperCase());
        const directionLabel = `${routeLabel} ${dirLabel}`;
        const id = `${feedId}-${slug(stopId)}-${directionId}`;
        if (seen.has(id)) continue;
        seen.add(id);

        options.push({
          id,
          type: "subway",
          label: `${routeLabel} · ${stopName} · ${dirLabel}`,
          stopLabel: stopName,
          directionLabel,
          directionId,
          feedId,
          feedStopId: stopId,
          stopId,
          routes,
        });
      }

      options.sort((a, b) => {
        const c = a.stopLabel.localeCompare(b.stopLabel);
        return c !== 0 ? c : a.directionLabel.localeCompare(b.directionLabel);
      });

      // stop_id -> stop_name for RT destination display (last stop in stopTimeUpdate)
      const stopNames = {};
      for (const [id, info] of stopById) {
        stopNames[id] = (info && info.stop_name) || id;
      }

      const outDir = path.dirname(OUT_PATH);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(OUT_PATH, JSON.stringify(options, null, 2), "utf-8");
      fs.writeFileSync(DESTINATIONS_OUT_PATH, JSON.stringify(feedDestinations, null, 2), "utf-8");
      fs.writeFileSync(STOP_NAMES_OUT_PATH, JSON.stringify(stopNames, null, 0), "utf-8");
      console.log(`Wrote ${options.length} subway options to ${OUT_PATH}`);
      console.log(`Wrote subway-destinations.json (${Object.keys(feedDestinations).length} feeds)`);
      console.log(`Wrote subway-stop-names.json (${Object.keys(stopNames).length} stops)`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

main();
