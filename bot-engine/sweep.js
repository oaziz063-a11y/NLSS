/**
 * sweep.js — hunt for live mobile game servers by DNS + WebSocket handshake.
 * If a host resolves AND speaks the agario protocol, we can connect directly
 * and join a party by sending the party token after connect.
 */
const dns = require("dns").promises;
const WebSocket = require("ws");

const REGIONS = ["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-west-3",
                 "eu-central-1","ap-northeast-1","ap-southeast-1","ap-south-1","sa-east-1"];

// hostname shapes seen across miniclip mobile infra
const SHAPES = [
  r => `mobile-live-${r}.agario.miniclippt.com`,
  r => `live-${r}.agario.miniclippt.com`,
  r => `${r}.agario.miniclippt.com`,
  r => `game-${r}.agario.miniclippt.com`,
  r => `arena-${r}.agario.miniclippt.com`,
  r => `sereng-prod-${r}.agario.miniclippt.com`,
  r => `mobile-${r}.agario.miniclippt.com`,
  r => `gs-${r}.agario.miniclippt.com`,
];

const EXTRA = [
  "sereng-prod-bacon-cdn.agario.miniclippt.com",
  "sereng-prod-bacon.agario.miniclippt.com",
  "mobile-live.agario.miniclippt.com",
  "live.agario.miniclippt.com",
  "gameserver.agario.miniclippt.com",
  "servers.agario.miniclippt.com",
  "matchmaking.agario.miniclippt.com",
  "mm.agario.miniclippt.com",
];

async function resolves(host) {
  try { const a = await dns.lookup(host); return a.address; }
  catch { return null; }
}

/** try an agario handshake — 254 + 255 — and see if the server answers */
function probeWS(url) {
  return new Promise((res) => {
    let ws;
    const done = (r) => { try { ws && ws.terminate(); } catch {} ; res(r); };
    try { ws = new WebSocket(url, { handshakeTimeout: 6000, origin: "https://agar.io" }); }
    catch (e) { return res({ ok: false, why: e.message }); }

    const t = setTimeout(() => done({ ok: false, why: "no reply" }), 7000);

    ws.on("open", () => {
      const h = Buffer.alloc(5); h.writeUInt8(254,0); h.writeUInt32LE(23,1);
      const k = Buffer.alloc(5); k.writeUInt8(255,0); k.writeUInt32LE(154669603,1);
      ws.send(h); ws.send(k);
    });
    ws.on("message", (d) => {
      clearTimeout(t);
      const b = Buffer.from(d);
      done({ ok: true, first: b.readUInt8(0), len: b.length, hex: b.slice(0,16).toString("hex") });
    });
    ws.on("error", (e) => { clearTimeout(t); done({ ok: false, why: e.message.slice(0,60) }); });
    ws.on("close", () => { clearTimeout(t); done({ ok: false, why: "closed" }); });
  });
}

(async () => {
  const hosts = new Set(EXTRA);
  for (const r of REGIONS) for (const s of SHAPES) hosts.add(s(r));

  console.log(`=== DNS SWEEP (${hosts.size} hosts) ===`);
  const live = [];
  for (const h of hosts) {
    const ip = await resolves(h);
    if (ip) { console.log(`LIVE  ${h} -> ${ip}`); live.push({ h, ip }); }
  }
  if (!live.length) console.log("(no hostnames resolved)");

  console.log(`\n=== WEBSOCKET PROBE (${live.length} live hosts) ===`);
  for (const { h, ip } of live) {
    for (const url of [`ws://${h}:443`, `wss://${h}:443`, `ws://${ip}:443`, `ws://${h}:80`]) {
      const r = await probeWS(url);
      if (r.ok) console.log(`*** SPEAKS PROTOCOL: ${url} | packet=${r.first} len=${r.len} hex=${r.hex}`);
      else console.log(`  --  ${url} (${r.why})`);
    }
  }
  console.log("\n=== DONE ===");
})();
