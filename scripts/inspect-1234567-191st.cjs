/**
 * Inspect 1234567 GTFS-RT feed for 1 line and stop 191 St (110 / 110N / 110S).
 * Run: node scripts/inspect-1234567-191st.cjs
 */
const https = require("https");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

// MTA returns NoSuchKey for nyct/gtfs-1234567; 1/2/3/4/5/6/7 may be at nyct/gtfs (no suffix)
const FEED_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";

function fetchFeed() {
  return new Promise((resolve, reject) => {
    const key = process.env.MTA_SUBWAY_GTFS_RT_KEY;
    const headers = { Accept: "application/x-protobuf" };
    if (key) headers["x-api-key"] = key;
    const url = new URL(FEED_URL);
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: "GET", headers };
    https.get(opts, (res) => {
      console.log("HTTP status:", res.statusCode);
      console.log("Content-Type:", res.headers["content-type"]);
      if (res.statusCode !== 200) {
        let body = "";
        res.on("data", (c) => (body += c.toString()));
        res.on("end", () => {
          resolve(null);
          console.log("Body:", body.slice(0, 500));
        });
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 200 && buf.toString("utf8").trim().startsWith("<")) {
          console.log("Response looks like HTML:", buf.toString("utf8").slice(0, 300));
          resolve(null);
          return;
        }
        console.log("Buffer length:", buf.length, "first 20 bytes:", buf.slice(0, 20));
        if (buf[0] === 0x3c) console.log("Body (UTF-8):", buf.toString("utf8").slice(0, 600));
        resolve(buf);
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  console.log("Fetching 1234567 feed...");
  const buf = await fetchFeed();
  if (!buf || buf.length === 0) {
    console.log("No data (check API key / URL).");
    process.exit(1);
  }
  if (buf[0] === 0x3c) {
    console.log("Server returned XML (error/terms page), not protobuf. Check API key or feed URL.");
    process.exit(1);
  }
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  const entities = feed.entity || [];
  console.log("Total entities:", entities.length);

  const stopIdsRoute1 = new Set();
  const stopIdsAll = new Set();
  let route1Count = 0;
  for (const entity of entities) {
    const tu = entity.tripUpdate;
    if (!tu?.stopTimeUpdate) continue;
    const routeId = (tu.trip && tu.trip.routeId) || "";
    for (const stu of tu.stopTimeUpdate) {
      const sid = stu.stopId;
      if (sid) stopIdsAll.add(sid);
      if (routeId === "1") {
        stopIdsRoute1.add(sid);
        route1Count++;
      }
    }
  }

  console.log("\nStop IDs for route 1 (sample, first 50):", Array.from(stopIdsRoute1).sort().slice(0, 50));
  console.log("191 St related (110, 110N, 110S):", {
    "110": stopIdsRoute1.has("110"),
    "110N": stopIdsRoute1.has("110N"),
    "110S": stopIdsRoute1.has("110S"),
  });
  console.log("\nAll unique stop_ids in feed (first 80):", Array.from(stopIdsAll).sort().slice(0, 80));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
