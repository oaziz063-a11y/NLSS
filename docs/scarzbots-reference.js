// ScarzBots v2 — WORKING web agar.io bot userscript (reference only, do not run here)
// Kept because it documents the real protocol. Key extracts below; see NOTES.md.
//
// ── HOW IT GETS THE SERVER (the important part) ──────────────────────────────
// It does NOT resolve a server. It hooks the real client's WebSocket:
//
//   WebSocket.prototype.send = function(data) {
//     if (!isAllowed(this.url)) botConfig.agarServer = this.url;
//     WebSocket.prototype._originalSend.call(this, data);
//   };
//
// ── SERVER URL SHAPE ─────────────────────────────────────────────────────────
//   wss://web-arenas-live-[\w-]+.agario.miniclippt.com/[\w-]+/[\d-]+
//
// ── VERSIONS ─────────────────────────────────────────────────────────────────
//   protocolVersion = 23
//   clientVersion   = 31116
//
// ── HANDSHAKE / ENCRYPTION ───────────────────────────────────────────────────
//   -> 254 [uint32 protocolVersion]
//   -> 255 [uint32 clientVersion]
//   <- 241 [uint32 decryptionKey][cstring serverVersion]
//          encryptionKey = murmur2(serverPathMatch + serverVersion, 255)
//   <- 242  => sendSpawn()
//
//   send:    data = xorBuffer(data, encryptionKey); encryptionKey = rotateKey(encryptionKey)
//   receive: data = xorBuffer(data, decryptionKey ^ clientVersion)
//   opcode 255 => LZ4-compressed inner message (uncompressMessage)
//
// ── PACKETS ──────────────────────────────────────────────────────────────────
//   ->  0  [cstring name]      spawn
//   -> 16  [i32 x][i32 y][u32 decryptionKey]   move   (key is NOT zero!)
//   -> 17                      split
//   -> 21                      eject / feed
//   <- 16  world update        <- 32 own cell id      <- 64 map bounds
//   <- 18  disconnect          <- 85 reconnect
//
// ── CELL FLAGS ───────────────────────────────────────────────────────────────
//   flags & 1   virus
//   flags & 2   colour (skip 3 bytes)
//   flags & 4   skin   (cstring)
//   flags & 8   name   (cstring)
//   flags & 128 => extended byte follows:
//       ext & 1  pellet
//       ext & 2  friend
//       ext & 4  skip 4 bytes
//
// ── KEY FUNCTIONS (verbatim, ported into crypto.js) ──────────────────────────
//
// rotateKey(key) {
//     key = Math.imul(key, 1540483477) >> 0;
//     key = Math.imul(key >>> 24 ^ key, 1540483477) >> 0 ^ 114296087;
//     key = Math.imul(key >>> 13 ^ key, 1540483477) >> 0;
//     return key >>> 15 ^ key;
// }
//
// xorBuffer(buffer, key) {
//     const dv = new DataView(buffer);
//     for (let i = 0; i < dv.byteLength; i++)
//         dv.setUint8(i, dv.getUint8(i) ^ key >>> i % 4 * 8 & 255);
//     return buffer;
// }
//
// murmur2(str, seed)  // standard murmur2, seed 255 — see crypto.js for full port
//
// ── OTHER NOTES ──────────────────────────────────────────────────────────────
//   MAX_BOTS = 200 in this script; bots created 1 per 600ms (rate limiting)
//   Bot names are shared; friend-detection used to avoid bots eating each other
