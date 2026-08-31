/**
 * crypto.js — Agar.io wire encryption, derived from the ScarzBots client.
 *
 * Handshake:
 *   -> 254 protocolVersion(23)
 *   -> 255 clientVersion(31116)
 *   <- 241 [decryptionKey uint32][serverVersion cstring]
 *          encryptionKey = murmur2(serverPath + serverVersion, 255)
 *   <- 242 spawn now
 *
 * Every outgoing packet: XOR with encryptionKey, then rotate the key.
 * Every incoming packet: XOR with (decryptionKey ^ clientVersion).
 * Opcode 255 wraps an LZ4-compressed inner message.
 */

const PROTOCOL_VERSION = 23;
const CLIENT_VERSION   = 31116;

/** murmur2 — must match the client's implementation exactly */
function murmur2(str, seed) {
  let len = str.length;
  let h = seed ^ len;
  let i = 0;
  while (len >= 4) {
    let k = (str.charCodeAt(i) & 255) |
            ((str.charCodeAt(++i) & 255) << 8) |
            ((str.charCodeAt(++i) & 255) << 16) |
            ((str.charCodeAt(++i) & 255) << 24);
    k = (k & 65535) * 1540483477 + ((((k >>> 16) * 1540483477) & 65535) << 16);
    k ^= k >>> 24;
    k = (k & 65535) * 1540483477 + ((((k >>> 16) * 1540483477) & 65535) << 16);
    h = ((h & 65535) * 1540483477 + ((((h >>> 16) * 1540483477) & 65535) << 16)) ^ k;
    len -= 4;
    ++i;
  }
  switch (len) {
    case 3: h ^= (str.charCodeAt(i + 2) & 255) << 16;
    case 2: h ^= (str.charCodeAt(i + 1) & 255) << 8;
    case 1: h ^= str.charCodeAt(i) & 255;
            h = (h & 65535) * 1540483477 + ((((h >>> 16) * 1540483477) & 65535) << 16);
  }
  h ^= h >>> 13;
  h = (h & 65535) * 1540483477 + ((((h >>> 16) * 1540483477) & 65535) << 16);
  h ^= h >>> 15;
  return h >>> 0;
}

/** advance the send key after each packet */
function rotateKey(key) {
  key = Math.imul(key, 1540483477) >> 0;
  key = ((Math.imul(key >>> 24 ^ key, 1540483477) >> 0) ^ 114296087);
  key = Math.imul(key >>> 13 ^ key, 1540483477) >> 0;
  return (key >>> 15 ^ key) >>> 0;
}

/** XOR a buffer with a rolling 4-byte key */
function xorBuffer(buf, key) {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i++) {
    out[i] = out[i] ^ ((key >>> ((i % 4) * 8)) & 255);
  }
  return out;
}

/** LZ4 block decompression — matches the client's uncompressMessage */
function lz4Decompress(src, dstLen) {
  const out = Buffer.alloc(dstLen);
  let i = 0, j = 0;
  while (i < src.length) {
    const token = src[i++];
    let litLen = token >> 4;
    if (litLen > 0) {
      let ext = litLen + 240;
      while (ext === 255) { ext = src[i++]; litLen += ext; }
      const end = i + litLen;
      while (i < end) out[j++] = src[i++];
      if (i === src.length) return out;
    }
    const offset = src[i++] | (src[i++] << 8);
    if (offset === 0 || offset > j) return out.slice(0, j);
    let matchLen = token & 15;
    let ext = matchLen + 240;
    while (ext === 255) { ext = src[i++]; matchLen += ext; }
    let pos = j - offset;
    const end = j + matchLen + 4;
    while (j < end && j < out.length) out[j++] = out[pos++];
  }
  return out;
}

module.exports = { PROTOCOL_VERSION, CLIENT_VERSION, murmur2, rotateKey, xorBuffer, lz4Decompress };
