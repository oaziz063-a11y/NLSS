/**
 * discover.js — find the live mobile server-discovery endpoint.
 * Run on Railway (no egress filter): node discover.js [PARTYKEY]
 */
const https = require("https");
const dns = require("dns").promises;

const KEY = process.argv[2] || "SJPCXC";
const REGIONS = ["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-west-3",
                 "eu-central-1","ap-northeast-1","ap-southeast-1","ap-south-1","sa-east-1"];

function req(host, path, method = "GET", body = null) {
  return new Promise((res) => {
    const data = body || "";
    const r = https.request({
      hostname: host, port: 443, path, method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": "agar.io/885 CFNetwork/1492.0.1 Darwin/23.3.0",
        "Accept": "*/*",
      },
    }, (rs) => {
      let b = ""; rs.on("data", c => b += c);
      rs.on("end", () => res({ host, path, status: rs.statusCode, len: b.length, body: b.slice(0, 400) }));
    });
    r.on("error", e => res({ host, path, err: e.code || e.message }));
    r.setTimeout(7000, () => { r.destroy(); res({ host, path, err: "timeout" }); });
    if (data) r.write(data);
    r.end();
  });
}

const HOSTS = [
  "mobile-live-v25-0.agario.miniclippt.com",
  "configs.agario.miniclippt.com",
  "configs-web.agario.miniclippt.com",
  "sereng-prod-bacon-cdn.agario.miniclippt.com",
];

(async () => {
  console.log("=== DNS ===");
  for (const h of [...HOSTS, "live-arena-v25-0.agario.miniclippt.com", "mobile-live-v26-0.agario.miniclippt.com"]) {
    try { const a = await dns.lookup(h); console.log(`OK   ${h} -> ${a.address}`); }
    catch (e) { console.log(`FAIL ${h} (${e.code})`); }
  }

  console.log("\n=== CONFIG FILES ===");
  const cfgPaths = [
    "/live/v885/GameConfiguration.json", "/live/v25/GameConfiguration.json",
    "/live/v5/885/GameConfiguration.json", "/live/GameConfiguration.json",
    "/live/v25/0/GameConfiguration.json", "/GameConfiguration.json",
    "/live/v885/config.json", "/live/config.json",
  ];
  for (const host of ["configs.agario.miniclippt.com", "configs-web.agario.miniclippt.com"]) {
    for (const p of cfgPaths) {
      const r = await req(host, p);
      if (r.status === 200) console.log(`*** HIT ${host}${p} len=${r.len}\n${r.body}\n`);
      else console.log(`  ${r.status || r.err}  ${host}${p}`);
    }
  }

  console.log("\n=== MOBILE HOST ENDPOINTS ===");
  const mh = "mobile-live-v25-0.agario.miniclippt.com";
  for (const p of ["/", "/status", "/servers", "/findServer", "/getToken", "/health", "/api/servers", "/matchmaking"]) {
    const r = await req(mh, p);
    console.log(`  ${r.status || r.err} len=${r.len || 0}  ${p}  ${(r.body||"").slice(0,120)}`);
  }

  console.log("\n=== REGION SERVER LOOKUP ===");
  for (const reg of REGIONS.slice(0, 4)) {
    for (const [h, p, m, b] of [
      [mh, `/findServer`, "POST", JSON.stringify({ region: reg, mode: "party", partyKey: KEY })],
      [mh, `/servers/${reg}`, "GET", null],
      ["configs.agario.miniclippt.com", `/live/servers/${reg}.json`, "GET", null],
    ]) {
      const r = await req(h, p, m, b);
      if (r.status === 200) console.log(`*** HIT ${h}${p} [${reg}]\n${r.body}\n`);
      else console.log(`  ${r.status || r.err}  ${h}${p} [${reg}]`);
    }
  }
  console.log("\n=== DONE ===");
})();
