/**
 * bot.js — a single Agar.io bot.
 *
 * Modes:
 *   feed          bots run at the target and eject mass into it
 *   farm          bots eat pellets until FARM_MASS, then switch to feed
 *   feedEveryone  bots suicide into whoever is nearest (party-wide mass)
 *   freeze        bots hold position, no movement
 *   idle          connected but doing nothing
 */
const WebSocket = require("ws");
const P = require("./protocol");

const TICK_MS        = 40;    // move packet cadence (25/s — matches real client)
const FEED_RANGE     = 240;   // start ejecting inside this radius
const SPLIT_RANGE    = 600;   // split toward target from this far when asked
const RESPAWN_MS     = 700;   // wait after death before respawning
const RECONNECT_MS   = 2500;  // wait after socket loss before reconnecting
const FARM_MASS      = 120;   // farm until this size, then go feed
const MAX_RESPAWNS   = 200;   // give up after this many failed spawns

const NICKS = [
  "feed", "mass", "donor", "gift", "snack", "bite", "chunk",
  "blob", "cell", "orb", "dot", "seed", "crumb", "morsel",
];

class Bot {
  constructor(opts) {
    this.index      = opts.index;
    this.server     = opts.server;       // "ip:port"
    this.token      = opts.token;
    this.targetUid  = opts.targetUid;    // name/uid substring to match
    this.mode       = opts.mode || "feed";
    this.nickMode   = opts.nickMode || "varied";
    this.onEvent    = opts.onEvent || (() => {});

    this.ws         = null;
    this.state      = "connecting";      // connecting|alive|dead|offline
    this.cells      = new Map();         // cellId -> cell
    this.ownIds     = new Set();
    this.target     = null;              // {x,y} of the player we serve
    this.map        = { minX: -7071, minY: -7071, maxX: 7071, maxY: 7071 };
    this.mass       = 0;
    this.fedCount   = 0;
    this.respawns   = 0;
    this.killed     = false;

    this.encKey    = 0;   // outgoing XOR key (rotates per send)
    this.decKey    = 0;   // incoming XOR key
    this.serverVer = null;
    this.serverPath = opts.serverPath || "";  // host+path, needed for key derivation

    this._tick = null;
    this._retry = null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  start() { this._connect(); }

  kill() {
    this.killed = true;
    clearInterval(this._tick);
    clearTimeout(this._retry);
    if (this.ws) { try { this.ws.terminate(); } catch {} }
    this.ws = null;
    this.state = "offline";
  }

  setMode(mode) { this.mode = mode; }

  /** one-shot command from the control panel */
  command(cmd) {
    if (!this._live()) return;
    if (cmd === "split")   this._send(P.pSplit());
    if (cmd === "eject")   this._send(P.pEject());
    if (cmd === "explode") this._send(P.pExplode());
    if (cmd === "respawn") this._spawn();
  }

  _live() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  /** send with XOR encryption + key rotation (raw for pre-241 handshake) */
  _send(buf, raw = false) {
    if (!this._live()) return;
    if (!raw && this.encKey) {
      buf = P.xorBuffer(buf, this.encKey);
      this.encKey = P.rotateKey(this.encKey);
    }
    this.ws.send(buf);
  }

  _nick() {
    if (this.nickMode === "blank") return "";
    if (this.nickMode === "uniform") return "bot";
    return NICKS[this.index % NICKS.length] + (this.index % 97);
  }

  // ── connection ─────────────────────────────────────────────────────────

  _connect() {
    if (this.killed) return;
    this.state = "connecting";

    let ws;
    try {
      ws = new WebSocket(`ws://${this.server}`, {
        handshakeTimeout: 12000,
        perMessageDeflate: false,
        origin: "https://agar.io",
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
      });
    } catch {
      return this._retryConnect();
    }

    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.on("open", () => {
      // handshake is sent unencrypted; server replies 241 with the keys
      ws.send(P.pHandshake());
      ws.send(P.pClientKey());
      const tok = P.pToken(this.token);
      if (tok) ws.send(tok);
    });

    ws.on("message", (d) => this._onMessage(d));
    ws.on("close", () => this._onDrop());
    ws.on("error", () => this._onDrop());
  }

  _retryConnect() {
    if (this.killed) return;
    this.state = "offline";
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._connect(), RECONNECT_MS);
  }

  _onDrop() {
    if (this.killed) return;
    clearInterval(this._tick);
    this.ownIds.clear();
    this.cells.clear();
    this.encKey = 0;
    this.decKey = 0;
    this._retryConnect();
  }

  // ── spawn / death ──────────────────────────────────────────────────────

  _spawn() {
    if (!this._live() || this.killed) return;
    if (this.respawns > MAX_RESPAWNS) { this.state = "offline"; return; }
    this.respawns++;
    this.ownIds.clear();
    this._send(P.pSpawn(this._nick()));
    this.state = "alive";
    clearInterval(this._tick);
    this._tick = setInterval(() => this._act(), TICK_MS);
  }

  _onDeath() {
    this.state = "dead";
    this.mass = 0;
    clearInterval(this._tick);
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._spawn(), RESPAWN_MS);
  }

  // ── per-tick behaviour ─────────────────────────────────────────────────

  _act() {
    if (!this._live() || this.state !== "alive") return;
    if (this.mode === "freeze" || this.mode === "idle") return;

    const me = this._myPos();
    if (!me) return;

    if (this.mode === "farm" && this.mass < FARM_MASS) return this._farm(me);
    if (this.mode === "feedEveryone") return this._feedNearest(me);
    return this._feedTarget(me);
  }

  /** run at the target, eject when close */
  _feedTarget(me) {
    const t = this.target || this._mapCenter();
    this._send(P.pMove(t.x, t.y, this.decKey));
    const d = this._dist(me, t);
    if (d < FEED_RANGE) {
      this._send(P.pEject());
      this.fedCount++;
      this.onEvent("fed", this.index);
    }
  }

  /** suicide-feed whoever is nearest — party-wide benefit */
  _feedNearest(me) {
    let best = null, bestD = Infinity;
    for (const c of this.cells.values()) {
      if (this.ownIds.has(c.cellId) || c.isVirus || c.isEjected) continue;
      if (c.size <= this.mass) continue;
      const d = this._dist(me, c);
      if (d < bestD) { bestD = d; best = c; }
    }
    const t = best || this.target || this._mapCenter();
    this._send(P.pMove(t.x, t.y, this.decKey));
    if (bestD < FEED_RANGE) { this._send(P.pEject()); this.fedCount++; }
  }

  /** eat pellets to grow before feeding */
  _farm(me) {
    let best = null, bestD = Infinity;
    for (const c of this.cells.values()) {
      if (!c.isEjected && c.size > 20) continue;     // pellets/ejected only
      if (this.ownIds.has(c.cellId)) continue;
      const d = this._dist(me, c);
      if (d < bestD) { bestD = d; best = c; }
    }
    const t = best || this._mapCenter();
    this._send(P.pMove(t.x, t.y, this.decKey));
  }

  _mapCenter() {
    return { x: (this.map.minX + this.map.maxX) / 2, y: (this.map.minY + this.map.maxY) / 2 };
  }

  _myPos() {
    let sx = 0, sy = 0, n = 0, mass = 0;
    for (const id of this.ownIds) {
      const c = this.cells.get(id);
      if (!c) continue;
      sx += c.x; sy += c.y; n++;
      mass += (c.size * c.size) / 100;
    }
    if (!n) return null;
    this.mass = Math.round(mass);
    return { x: sx / n, y: sy / n };
  }

  _dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── packet handling ────────────────────────────────────────────────────

  _onMessage(data) {
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // everything after the 241 handshake is XOR'd
    if (this.decKey) buf = P.xorBuffer(buf, (this.decKey ^ P.CLIENT_VERSION) >>> 0);

    // opcode 255 wraps an LZ4-compressed inner message
    if (buf.length > 5 && buf.readUInt8(0) === 255) {
      const outLen = buf.readUInt32LE(1);
      buf = P.lz4Decompress(buf.slice(5), outLen);
    }

    const p = P.decode(buf);

    switch (p.type) {
      case "crypto_handshake":
        this.decKey    = p.decryptionKey;
        this.serverVer = p.serverVersion;
        this.encKey    = P.deriveEncryptionKey(this.serverPath, p.serverVersion);
        break;

      case "spawn_now":
        this._spawn();
        break;

      case "map_size":
        this.map = p;
        break;

      case "own_cell":
        this.ownIds.add(p.cellId);
        if (this.state !== "alive") {
          this.state = "alive";
          clearInterval(this._tick);
          this._tick = setInterval(() => this._act(), TICK_MS);
        }
        break;

      case "world_update": {
        for (const c of p.cells) this.cells.set(c.cellId, c);

        for (const { eaten } of p.eats) {
          this.cells.delete(eaten);
          if (this.ownIds.delete(eaten) && this.ownIds.size === 0) this._onDeath();
        }
        for (const id of p.gone) {
          this.cells.delete(id);
          if (this.ownIds.delete(id) && this.ownIds.size === 0) this._onDeath();
        }

        this._locateTarget();
        break;
      }

      case "reset_cells":
        this.cells.clear();
        this.ownIds.clear();
        if (this.state === "alive") this._onDeath();
        break;
    }
  }

  /**
   * Find the player we're feeding.
   * Prefer an exact name/uid match; otherwise fall back to the biggest
   * non-virus cell that isn't ours (in a private party that's the human).
   */
  _locateTarget() {
    const uid = (this.targetUid || "").toLowerCase();
    let named = null, biggest = null;

    for (const c of this.cells.values()) {
      if (this.ownIds.has(c.cellId) || c.isVirus || c.isEjected) continue;
      if (uid && c.name && c.name.toLowerCase().includes(uid)) {
        if (!named || c.size > named.size) named = c;
      }
      if (!biggest || c.size > biggest.size) biggest = c;
    }

    const pick = named || biggest;
    if (pick) this.target = { x: pick.x, y: pick.y, size: pick.size, name: pick.name };
  }

  // ── reporting ──────────────────────────────────────────────────────────

  snapshot() {
    return {
      i: this.index,
      state: this.state,
      mass: this.mass,
      fed: this.fedCount,
      respawns: this.respawns,
      hasTarget: !!this.target,
    };
  }
}

module.exports = { Bot, NICKS };
