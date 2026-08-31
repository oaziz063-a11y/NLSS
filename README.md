# Agar.io Mobile Bot System

Personal feeder-bot system for Agar.io **mobile**. Website control panel + Node bot engine.

**Live URLs**
- Website: https://website-production-c12a.up.railway.app
- Engine:  https://bot-engine-production-4459.up.railway.app
- Password: set via `ENGINE_PASSWORD` on the engine service

---

## ⚠️ CURRENT STATUS — READ THIS FIRST

**Everything is built and deployed. One piece is missing: the game server URL.**

Hitting Start fails at server resolution. Nothing else is broken.

### What we proved (don't redo this work)

| Attempt | Result |
|---|---|
| `m.agar.io/getToken` (old agario-client method) | **DNS dead** — endpoint retired |
| `configs.agario.miniclippt.com` — 8 config paths | **403 on every path** (CloudFront edge block, not 404) |
| `configs-web.agario.miniclippt.com` — 8 paths | **403 on every path** |
| `sereng-prod-bacon-cdn` — ~40 REST routes enumerated | Only `GET /health` → `{"status":"healthy"}`. All else 404 |
| DNS sweep, 96 region hostname shapes | 1 resolved, and it's a CDN that 404s on WebSocket |
| DNS sweep, 752 `*-arenas-live-*` shapes | **0 resolved** |

Conclusion: server addresses are allocated per-match and handed out by an
authenticated endpoint. **They cannot be guessed, scanned, or searched.**

### Why every working bot service does it differently

The ScarzBots userscript (`docs/scarzbots-reference.js`) is a *working* web bot.
It never resolves a server. It hooks `WebSocket.prototype.send` and steals the
URL from the real game client running in the same browser:

```js
WebSocket.prototype.send = function(data) {
  if (!isAllowed(this.url)) botConfig.agarServer = this.url;   // <-- steals it
  WebSocket.prototype._originalSend.call(this, data);
};
```

Mobile bot services do the equivalent. **Observing a real client is the method,
not a workaround.**

### THE NEXT STEP

Capture the mobile client's WebSocket URL (iPhone + Mac, no jailbreak needed):

```bash
rvictl -s <IPHONE_UDID>                      # start remote capture interface
sudo tcpdump -i rvi0 -s0 -w ~/Desktop/agar.pcap
# join a game on the phone, then Ctrl+C
strings ~/Desktop/agar.pcap | grep -iE "arenas|miniclippt|GET /|Host:" | head -40
rvictl -x <IPHONE_UDID>                      # tear down
```

**We need the FULL URL, not just an IP.** The encryption key is derived from the
hostname *and path*:

```js
encryptionKey = murmur2(host + "/" + path + serverVersion, 255)
```

An IP alone is not enough.

Once you have the URL, put it in `bot-engine/resolver.js`:

```js
const REGION_SERVERS = {
  "eu-west-3": "wss://web-arenas-live-xx.agario.miniclippt.com/PATH/123-456",
};
```

That's the only edit needed. Everything else already works.

---

## Architecture

Region + UID are the primary inputs — party link is optional. This matches how
real mobile bot services work: bots join the *region's* server and find the
player by UID on the map.

```
website (React)  --HTTP-->  bot-engine (Node)  --WebSocket xN-->  agar.io server
```

- `bot-engine/crypto.js`   — murmur2, key rotation, XOR cipher, LZ4 decompression
- `bot-engine/protocol.js` — packet encode/decode
- `bot-engine/bot.js`      — one bot: connect, spawn, target, move, feed, respawn
- `bot-engine/resolver.js` — party key / region / direct URL → server address
- `bot-engine/index.js`    — Express control API
- `website/src/App.jsx`    — control panel

### Protocol (protocol 23, clientVersion 31116)

Verified against the ScarzBots reference client.

**Handshake**
```
-> 254 [uint32 protocolVersion = 23]
-> 255 [uint32 clientVersion  = 31116]
<- 241 [uint32 decryptionKey][cstring serverVersion]
       encryptionKey = murmur2(serverPath + serverVersion, 255)
<- 242  spawn now
-> 0   [cstring name]
```

**Encryption** — every outgoing packet XOR'd with `encryptionKey`, key rotated
after each send. Incoming XOR'd with `decryptionKey ^ clientVersion`.
Opcode `255` wraps an LZ4-compressed inner message.

**Packets**
| ID | Direction | Meaning |
|---|---|---|
| 0   | → | spawn with name |
| 16  | → | move to x,y (3rd field = decryptionKey, NOT zero) |
| 17  | → | split |
| 21  | → | eject mass / feed |
| 16  | ← | world update (cells, eats, removals) |
| 32  | ← | own cell id |
| 64  | ← | map bounds |
| 241 | ← | encryption handshake |
| 242 | ← | spawn signal |
| 255 | ← | LZ4-compressed wrapper |

**Cell flags** — `flags & 128` means an extended flags byte follows.
`extended & 1` = pellet, `extended & 2` = friend.

---

## Modes

| Mode | Behaviour |
|---|---|
| Feed me | Bots rush the target UID and eject mass |
| Farm first | Eat pellets to ~120 mass, then feed — ~12× more mass per bot |
| Feed everyone | Bots die into whoever is nearest |
| Freeze | Hold position |
| Idle | Connected, inactive |

Live controls while running: switch mode, scale bot count, split all/half,
eject, force respawn.

## API

```
POST /start    { uid, region, partyKey?, botCount, mode, nickMode }
POST /stop
POST /mode     { mode }
POST /command  { cmd: split|eject|explode|respawn, scope: all|half|quarter }
POST /scale    { botCount }
GET  /status
GET  /health
```
Auth via `x-engine-key` header (matches `ENGINE_PASSWORD`).

## Env vars

**bot-engine:** `ENGINE_PASSWORD`, `MAX_BOTS` (450), `SPAWN_RATE` (12/sec), `PORT`
**website:** `VITE_API_URL`

## Known risk

The most advanced public protocol-23 project lists as *unsolved*: IP-ban from
Miniclip, spawning >150 bots per server, and respawn failures after repeated
deaths — and that was **with** proxies. Start at ~20 bots from Railway's single
IP and scale up. If bots cut out at a threshold, that's the IP limit, not a bug.

## Diagnostic scripts

Run on Railway (local sandboxes may block miniclippt.com):
- `node probe.js SJPCXC` — party key resolution
- `node discover.js` — config/CDN endpoint discovery
- `node sweep.js` — DNS + WebSocket sweep for game servers
- `node apihunt.js` — REST route enumeration
- `node arenahunt.js` — arena hostname pattern hunt
