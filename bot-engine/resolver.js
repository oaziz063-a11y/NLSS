const https = require("https");
const http = require("http");

let cachedEndpoint = null;

const CANDIDATES = [
  { ssl: true,  host: "configs.agario.miniclippt.com",              path: "/getToken",    method: "POST" },
  { ssl: true,  host: "sereng-prod-bacon-cdn.agario.miniclippt.com", path: "/getToken",    method: "POST" },
  { ssl: true,  host: "configs.agario.miniclippt.com",              path: "/v1/getToken", method: "POST" },
  { ssl: false, host: "m.agar.io",                                   path: "/getToken",    method: "POST" },
];

function httpPost(ssl, host, path, data) {
  return new Promise((resolve) => {
    const mod = ssl ? https : http;
    const port = ssl ? 443 : 80;
    const buf = Buffer.from(data);
    const req = mod.request({
      hostname: host, port, path, method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": buf.length,
        "User-Agent": "com.miniclip.agar.io/885 CFNetwork/1492.0.1 Darwin/23.3.0",
        "Origin": ssl ? "https://agar.io" : "http://agar.io",
        "Host": host,
      },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ error: "timeout" }); });
    req.write(buf);
    req.end();
  });
}

function looksLikeServer(body) {
  if (!body) return false;
  const first = body.trim().split("\n")[0];
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$/.test(first.trim());
}

async function resolveParty(rawKey) {
  const m = rawKey.match(/[?&]party=([A-Z0-9]{4,12})/i);
  const key = m ? m[1].toUpperCase() : rawKey.trim().toUpperCase();

  if (cachedEndpoint) {
    const r = await httpPost(cachedEndpoint.ssl, cachedEndpoint.host, cachedEndpoint.path, key);
    if (!r.error && r.status === 200 && looksLikeServer(r.body)) {
      const lines = r.body.trim().split("\n");
      return { server: lines[0].trim(), token: lines[1]?.trim() || "", key };
    }
    cachedEndpoint = null;
  }

  console.log(`[resolver] Probing endpoints for key: ${key}`);
  for (const ep of CANDIDATES) {
    const r = await httpPost(ep.ssl, ep.host, ep.path, key);
    console.log(`[resolver] ${ep.host}${ep.path} -> status=${r.status} error=${r.error} body=${(r.body||"").slice(0, 80)}`);
    if (!r.error && r.status === 200 && looksLikeServer(r.body)) {
      cachedEndpoint = ep;
      const lines = r.body.trim().split("\n");
      console.log(`[resolver] Working endpoint: ${ep.host}${ep.path}`);
      return { server: lines[0].trim(), token: lines[1]?.trim() || "", key };
    }
  }

  throw new Error(`Could not resolve party key "${key}". All endpoints failed.`);
}

module.exports = { resolveParty };
