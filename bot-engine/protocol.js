/**
 * protocol.js — Agar.io binary protocol (Protocol 23)
 * Encodes client→server packets, decodes server→client packets.
 */

const PROTOCOL_VERSION = 23;
const CLIENT_KEY = 154669603;

// ═══ OUTGOING (client → server) ═══════════════════════════════════════════

/** Packet 254 — protocol handshake, must be sent first */
function pHandshake(version = PROTOCOL_VERSION) {
  const b = Buffer.alloc(5);
  b.writeUInt8(254, 0);
  b.writeUInt32LE(version, 1);
  return b;
}

/** Packet 255 — client key handshake, sent right after 254 */
function pClientKey(key = CLIENT_KEY) {
  const b = Buffer.alloc(5);
  b.writeUInt8(255, 0);
  b.writeUInt32LE(key, 1);
  return b;
}

/** Packet 80 — server token from party resolution */
function pToken(token) {
  if (!token) return null;
  const t = Buffer.from(token, "utf8");
  const b = Buffer.alloc(1 + t.length);
  b.writeUInt8(80, 0);
  t.copy(b, 1);
  return b;
}

/** Packet 0 — spawn with nickname (UTF-16LE, null terminated) */
function pSpawn(name = "") {
  const n = Buffer.from(String(name), "utf16le");
  const b = Buffer.alloc(1 + n.length + 2);
  b.writeUInt8(0, 0);
  n.copy(b, 1);
  b.writeUInt16LE(0, 1 + n.length);
  return b;
}

/** Packet 16 — move toward world coordinates */
function pMove(x, y) {
  const b = Buffer.alloc(13);
  b.writeUInt8(16, 0);
  b.writeInt32LE(Math.round(x), 1);
  b.writeInt32LE(Math.round(y), 5);
  b.writeUInt32LE(0, 9);
  return b;
}

/** Packet 17 — split (space bar) */
function pSplit() {
  return Buffer.from([17]);
}

/** Packet 21 — eject mass / feed (W key) */
function pEject() {
  return Buffer.from([21]);
}

/** Packet 1 — spectate mode */
function pSpectate() {
  return Buffer.from([1]);
}

/** Packet 18 / 19 — explode / stop */
function pExplode() {
  return Buffer.from([18]);
}

// ═══ INCOMING (server → client) ═══════════════════════════════════════════

function decode(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 1) return { type: "empty" };
  const id = buf.readUInt8(0);

  try {
    switch (id) {
      case 16:  return decodeWorldUpdate(buf);
      case 17:  return decodeSpectateField(buf);
      case 20:  return { type: "reset_cells" };
      case 21:  return { type: "draw_line" };
      case 32:  return { type: "own_cell", cellId: buf.readUInt32LE(1) };
      case 49:  return decodeLeaderboard(buf);
      case 64:  return decodeMapSize(buf);
      case 240: return { type: "wrapped" };
      case 254: return { type: "server_hello" };
      case 255: return { type: "server_key" };
      default:  return { type: "unknown", id };
    }
  } catch (err) {
    return { type: "decode_error", id, error: err.message };
  }
}

/** Packet 16 — the main world update: eats, cell states, removals */
function decodeWorldUpdate(buf) {
  let o = 1;
  const eats = [];
  const cells = [];
  const gone = [];

  // ── Eat records ──
  const eatCount = buf.readUInt16LE(o); o += 2;
  for (let i = 0; i < eatCount; i++) {
    if (o + 8 > buf.length) break;
    eats.push({ eater: buf.readUInt32LE(o), eaten: buf.readUInt32LE(o + 4) });
    o += 8;
  }

  // ── Cell update records (terminated by id 0) ──
  while (o + 4 <= buf.length) {
    const cellId = buf.readUInt32LE(o); o += 4;
    if (cellId === 0) break;
    if (o + 10 > buf.length) break;

    const x    = buf.readInt32LE(o);  o += 4;
    const y    = buf.readInt32LE(o);  o += 4;
    const size = buf.readUInt16LE(o); o += 2;

    if (o >= buf.length) break;
    const flags = buf.readUInt8(o); o += 1;

    const isVirus   = (flags & 0x01) !== 0;
    const hasColor  = (flags & 0x02) !== 0;
    const hasSkin   = (flags & 0x04) !== 0;
    const hasName   = (flags & 0x08) !== 0;
    const isEjected = (flags & 0x20) !== 0;

    let color = null, skin = null, name = null;

    if (hasColor && o + 3 <= buf.length) {
      color = (buf.readUInt8(o) << 16) | (buf.readUInt8(o + 1) << 8) | buf.readUInt8(o + 2);
      o += 3;
    }
    if (hasSkin) {
      const start = o;
      while (o < buf.length && buf.readUInt8(o) !== 0) o++;
      skin = buf.toString("utf8", start, o);
      o++;
    }
    if (hasName) {
      const start = o;
      while (o + 1 < buf.length && buf.readUInt16LE(o) !== 0) o += 2;
      name = buf.toString("utf16le", start, o);
      o += 2;
    }

    cells.push({ cellId, x, y, size, isVirus, isEjected, color, skin, name });
  }

  // ── Removed cell ids ──
  if (o + 2 <= buf.length) {
    const goneCount = buf.readUInt16LE(o); o += 2;
    for (let i = 0; i < goneCount; i++) {
      if (o + 4 > buf.length) break;
      gone.push(buf.readUInt32LE(o)); o += 4;
    }
  }

  return { type: "world_update", eats, cells, gone };
}

function decodeMapSize(buf) {
  if (buf.length < 33) return { type: "map_size", minX: -7071, minY: -7071, maxX: 7071, maxY: 7071 };
  return {
    type: "map_size",
    minX: buf.readDoubleLE(1),
    minY: buf.readDoubleLE(9),
    maxX: buf.readDoubleLE(17),
    maxY: buf.readDoubleLE(25),
  };
}

function decodeSpectateField(buf) {
  if (buf.length < 13) return { type: "spectate_field" };
  return {
    type: "spectate_field",
    x: buf.readFloatLE(1),
    y: buf.readFloatLE(5),
    zoom: buf.readFloatLE(9),
  };
}

function decodeLeaderboard(buf) {
  const names = [];
  let o = 1;
  if (o + 4 > buf.length) return { type: "leaderboard", names };
  const count = buf.readUInt32LE(o); o += 4;
  for (let i = 0; i < count; i++) {
    if (o + 4 > buf.length) break;
    o += 4; // cell id
    const start = o;
    while (o + 1 < buf.length && buf.readUInt16LE(o) !== 0) o += 2;
    names.push(buf.toString("utf16le", start, o));
    o += 2;
  }
  return { type: "leaderboard", names };
}

module.exports = {
  PROTOCOL_VERSION, CLIENT_KEY,
  pHandshake, pClientKey, pToken, pSpawn, pMove, pSplit, pEject, pSpectate, pExplode,
  decode,
};
