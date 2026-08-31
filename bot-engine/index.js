/**
 * index.js — bot engine control server
 *
 *  POST /start    { partyKey, uid, botCount, mode, nickMode }
 *  POST /stop
 *  POST /mode     { mode }              switch mode live
 *  POST /command  { cmd, scope }        split | eject | explode | respawn
 *  POST /scale    { botCount }          add/remove bots live
 *  GET  /status
 *  GET  /health
 */
const express = require("express");
const cors = require("cors");
const { resolveParty } = require("./resolver");
const { Bot } = require("./bot");

const app = express();
app.use(cors());
app.use(express.json());

const PORT       = process.env.PORT || 3001;
const AUTH       = process.env.ENGINE_PASSWORD || "";
const MAX_BOTS   = parseInt(process.env.MAX_BOTS || "450", 10);
const SPAWN_RATE = parseInt(process.env.SPAWN_RATE || "12", 10); // per second

const session = {
  bots: [], server: null, token: null, uid: null,
  mode: "feed", nickMode: "varied",
  running: false, startedAt: null, totalFed: 0,
  logs: [],
};

function log(level, msg) {
  const line = { t: Date.now(), level, msg };
  session.logs.push(line);
  if (session.logs.length > 300) session.logs.shift();
  console.log(`[${level}] ${msg}`);
}

// simple shared-secret gate; the browser sends it with each control call
function auth(req, res, next) {
  if (!AUTH) return next();
  const given = req.get("x-engine-key") || req.body?.key;
  if (given !== AUTH) return res.status(401).json({ error: "Bad password" });
  next();
}

// ── start ────────────────────────────────────────────────────────────────
app.post("/start", auth, async (req, res) => {
  const { partyKey, uid, botCount = 100, mode = "feed", nickMode = "varied", region = "auto" } = req.body || {};
  if (!partyKey) return res.status(400).json({ error: "partyKey required" });
  if (!uid)      return res.status(400).json({ error: "uid required" });

  if (session.running) stopAll();

  session.logs = [];
  log("info", `Resolving ${partyKey} (region ${region})...`);

  let resolved;
  try {
    resolved = await resolveParty(partyKey, region);
  } catch (e) {
    log("error", e.message);
    return res.status(502).json({ error: e.message, logs: session.logs });
  }

  session.server    = resolved.server;
  session.token     = resolved.token;
  session.uid       = uid;
  session.mode      = mode;
  session.nickMode  = nickMode;
  session.running   = true;
  session.startedAt = Date.now();
  session.totalFed  = 0;

  log("info", `Server ${resolved.server} — spawning ${botCount} bots (${mode})`);

  const n = Math.min(Math.max(1, parseInt(botCount, 10)), MAX_BOTS);
  for (let i = 0; i < n; i++) spawnBot(i);

  res.json({ ok: true, server: resolved.server, spawning: n });
});

function spawnBot(i) {
  const bot = new Bot({
    index: i,
    server: session.server,
    token: session.token,
    targetUid: session.uid,
    mode: session.mode,
    nickMode: session.nickMode,
    onEvent: (ev) => { if (ev === "fed") session.totalFed++; },
  });
  session.bots.push(bot);
  // stagger so we don't hammer the server and trip rate limits
  setTimeout(() => { if (session.running) bot.start(); }, (i / SPAWN_RATE) * 1000);
}

// ── stop ─────────────────────────────────────────────────────────────────
app.post("/stop", auth, (req, res) => {
  stopAll();
  res.json({ ok: true });
});

function stopAll() {
  log("info", `Stopping ${session.bots.length} bots`);
  for (const b of session.bots) b.kill();
  session.bots = [];
  session.running = false;
  session.totalFed = 0;
}

// ── live mode switch ─────────────────────────────────────────────────────
app.post("/mode", auth, (req, res) => {
  const { mode } = req.body || {};
  const valid = ["feed", "farm", "feedEveryone", "freeze", "idle"];
  if (!valid.includes(mode)) return res.status(400).json({ error: `mode must be one of ${valid.join(", ")}` });
  session.mode = mode;
  for (const b of session.bots) b.setMode(mode);
  log("info", `Mode → ${mode}`);
  res.json({ ok: true, mode });
});

// ── one-shot commands ────────────────────────────────────────────────────
app.post("/command", auth, (req, res) => {
  const { cmd, scope = "all" } = req.body || {};
  const valid = ["split", "eject", "explode", "respawn"];
  if (!valid.includes(cmd)) return res.status(400).json({ error: `cmd must be one of ${valid.join(", ")}` });

  let targets = session.bots;
  if (scope === "half")    targets = session.bots.filter((_, i) => i % 2 === 0);
  if (scope === "quarter") targets = session.bots.filter((_, i) => i % 4 === 0);

  for (const b of targets) b.command(cmd);
  log("info", `${cmd} → ${targets.length} bots`);
  res.json({ ok: true, affected: targets.length });
});

// ── scale up/down live ───────────────────────────────────────────────────
app.post("/scale", auth, (req, res) => {
  if (!session.running) return res.status(400).json({ error: "Not running" });
  const want = Math.min(Math.max(1, parseInt(req.body?.botCount, 10) || 0), MAX_BOTS);
  const have = session.bots.length;

  if (want > have) {
    for (let i = have; i < want; i++) spawnBot(i);
    log("info", `Scaling up ${have} → ${want}`);
  } else if (want < have) {
    for (const b of session.bots.splice(want)) b.kill();
    log("info", `Scaling down ${have} → ${want}`);
  }
  res.json({ ok: true, botCount: session.bots.length });
});

// ── status ───────────────────────────────────────────────────────────────
app.get("/status", (req, res) => {
  let alive = 0, dead = 0, connecting = 0, offline = 0, mass = 0;
  for (const b of session.bots) {
    if (b.state === "alive")      { alive++; mass += b.mass; }
    else if (b.state === "dead")       dead++;
    else if (b.state === "connecting") connecting++;
    else offline++;
  }
  res.json({
    running: session.running,
    server: session.server,
    mode: session.mode,
    total: session.bots.length,
    alive, dead, connecting, offline,
    botMass: mass,
    totalFed: session.totalFed,
    uptime: session.startedAt ? Math.floor((Date.now() - session.startedAt) / 1000) : 0,
    logs: session.logs.slice(-60),
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => log("info", `Engine listening on ${PORT} (max ${MAX_BOTS} bots)`));
