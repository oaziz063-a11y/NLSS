/**
 * apihunt.js — sereng-prod-bacon-cdn returns API-Gateway-style 404 JSON,
 * meaning it's a live REST API with routes we haven't found.
 * Enumerate plausible region/server-discovery routes.
 */
const https = require("https");

const HOST = process.argv[2] || "sereng-prod-bacon-cdn.agario.miniclippt.com";
const REGION = "eu-west-3";

function call(path, method = "GET", body = null) {
  return new Promise((res) => {
    const data = body || "";
    const r = https.request({
      hostname: HOST, port: 443, path, method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": "agar.io/885 CFNetwork/1492.0.1 Darwin/23.3.0",
        "Accept": "application/json",
        "X-Unity-Version": "2021.3.16f1",
      },
    }, (rs) => {
      let b = ""; rs.on("data", c => b += c);
      rs.on("end", () => res({ path, method, status: rs.statusCode, body: b.slice(0, 300) }));
    });
    r.on("error", e => res({ path, method, err: e.code }));
    r.setTimeout(6000, () => { r.destroy(); res({ path, method, err: "timeout" }); });
    if (data) r.write(data);
    r.end();
  });
}

const PATHS = [
  "/", "/v1", "/api", "/live", "/prod",
  "/servers", "/server", "/serverlist", "/getServer", "/findServer",
  "/regions", "/region", "/gameserver", "/gameservers",
  "/matchmaking", "/matchmake", "/mm", "/join", "/connect",
  "/v1/servers", "/v1/getServer", "/v1/findServer", "/v1/regions", "/v1/matchmaking",
  "/api/servers", "/api/getServer", "/api/regions", "/api/v1/servers",
  `/servers/${REGION}`, `/region/${REGION}`, `/v1/servers/${REGION}`,
  `/getServer/${REGION}`, `/live/${REGION}`, `/${REGION}`,
  `/servers?region=${REGION}`, `/getServer?region=${REGION}`,
  "/status", "/health", "/ping", "/version", "/config",
];

(async () => {
  console.log(`=== ENUMERATING ${HOST} ===\n`);
  const hits = [];

  for (const p of PATHS) {
    const r = await call(p);
    const tag = r.status === 200 ? "*** 200" : `    ${r.status || r.err}`;
    if (r.status === 200 || (r.status && r.status !== 404 && r.status !== 403)) {
      console.log(`${tag}  GET ${p}  ${r.body}`);
      hits.push(r);
    }
  }

  console.log("\n--- POST attempts ---");
  for (const p of ["/getServer", "/findServer", "/matchmaking", "/v1/getServer", "/servers", "/join"]) {
    for (const b of [
      JSON.stringify({ region: REGION }),
      JSON.stringify({ region: REGION, mode: "party" }),
      JSON.stringify({ region: REGION, gameMode: "ffa", version: 885 }),
    ]) {
      const r = await call(p, "POST", b);
      if (r.status && r.status !== 404 && r.status !== 403) {
        console.log(`*** ${r.status}  POST ${p}  ${b}\n     -> ${r.body}`);
        hits.push(r);
      }
    }
  }

  console.log(`\n=== ${hits.length} non-404/403 responses ===`);
  if (!hits.length) console.log("Everything 404/403 — routes not guessable on this host.");
})();
