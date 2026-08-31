/**
 * arenahunt.js — the ScarzBots script revealed the real server hostname shape:
 *   wss://web-arenas-live-XX.agario.miniclippt.com/PATH/NUMBERS
 * Hunt the mobile equivalent.
 */
const dns = require("dns").promises;

const PREFIXES = ["web", "mobile", "ios", "app", "client", "game", "live", "prod"];
const MIDS = ["arenas-live", "arena-live", "arenas", "arena", "live-arenas"];
const SUFFIXES = ["", "-v1", "-v2", "-v3", "-0", "-1", "-2", "-3",
                  "-eu", "-us", "-ap", "-eu-west-3", "-us-east-1", "-ap-south-1",
                  "-eu-west", "-us-east", "-ap-southeast"];

async function ok(h) {
  try { const a = await dns.lookup(h); return a.address; } catch { return null; }
}

(async () => {
  const hosts = new Set();
  for (const p of PREFIXES)
    for (const m of MIDS)
      for (const s of SUFFIXES)
        hosts.add(`${p}-${m}${s}.agario.miniclippt.com`);

  // also bare numbered variants like web-arenas-live-1
  for (const p of PREFIXES)
    for (let i = 0; i <= 12; i++)
      hosts.add(`${p}-arenas-live-${i}.agario.miniclippt.com`);

  console.log(`=== RESOLVING ${hosts.size} CANDIDATES ===\n`);
  const live = [];
  let n = 0;
  for (const h of hosts) {
    const ip = await ok(h);
    n++;
    if (ip) { console.log(`LIVE  ${h} -> ${ip}`); live.push({ h, ip }); }
  }
  console.log(`\n=== ${live.length} live of ${n} ===`);
  if (!live.length) console.log("none resolved");
})();
