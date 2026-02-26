/**
 * One-off: fetch ACE GTFS-RT, find the next A train at W 4th (A32N), dump raw entity.
 * Run: node scripts/inspect-ace-a32n.cjs  (subway RT feeds do not require API key per api.mta.info)
 */
const https = require("https");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

const FEED_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace";
const TARGET_STOP = "A32N";  // W 4 St-Wash Sq, Northbound
const TARGET_ROUTE = "A";

function fetchFeed() {
  return new Promise((resolve, reject) => {
    const key = process.env.MTA_SUBWAY_GTFS_RT_KEY;
    const headers = { Accept: "application/x-protobuf" };
    if (key) headers["x-api-key"] = key;
    const url = new URL(FEED_URL);
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: "GET", headers };
    https.get(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function toPlainObject(obj, seen = new Set()) {
  if (obj == null) return obj;
  if (seen.has(obj)) return "[Circular]";
  if (typeof obj !== "object") return obj;
  if (obj instanceof Uint8Array) return Array.from(obj);
  if (Object.prototype.toString.call(obj) === "[object Number]") return typeof obj.toNumber === "function" ? obj.toNumber() : obj;
  try {
    if (typeof obj.toObject === "function") return obj.toObject();
  } catch (_) {}
  const next = new Set(seen).add(obj);
  const out = Array.isArray(obj) ? [] : {};
  for (const key of Object.keys(obj)) {
    try {
      out[key] = toPlainObject(obj[key], next);
    } catch (_) {
      out[key] = "[?]";
    }
  }
  return out;
}

async function main() {
  console.log("Fetching ACE feed (subway RT does not require API key)...");
  const buf = await fetchFeed();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  const entities = feed.entity || [];
  console.log("Total entities:", entities.length);

  let found = null;
  for (const entity of entities) {
    const tu = entity.tripUpdate;
    if (!tu || !tu.trip) continue;
    const routeId = tu.trip.routeId;
    const stopUpdates = tu.stopTimeUpdate || [];
    const hasStop = stopUpdates.some((stu) => stu.stopId === TARGET_STOP);
    if (routeId === TARGET_ROUTE && hasStop) {
      found = entity;
      break;
    }
  }

  if (!found) {
    console.log("No A train found at", TARGET_STOP);
    process.exit(0);
  }

  console.log("\n--- First A train at W 4th (A32N): raw entity (plain object) ---\n");
  const plain = toPlainObject(found);
  console.log(JSON.stringify(plain, null, 2));

  console.log("\n--- Trip descriptor keys (to see if headsign/trip_headsign exists on decoded object) ---");
  const trip = found.tripUpdate?.trip;
  if (trip) {
    console.log("Keys on trip:", Object.keys(trip));
    console.log("tripId:", trip.tripId);
    console.log("routeId:", trip.routeId);
    console.log("directionId:", trip.directionId);
    console.log("startTime:", trip.startTime);
    console.log("startDate:", trip.startDate);
    if (trip.tripProperties) console.log("tripProperties:", toPlainObject(trip.tripProperties));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
