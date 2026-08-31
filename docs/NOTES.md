# Working Notes

## Where we are
Full system built and deployed. **Blocked on one thing: the game server URL.**

## The blocker, precisely
Bots need a WebSocket URL to connect to. Agar.io hands these out per-match from an
authenticated endpoint. Exhaustively proven not guessable — see README table.

**The encryption key depends on the URL path**, so an IP address alone is
insufficient. We need the full `wss://host/path/numbers` form.

## How real bot services solve it
They don't resolve anything. `docs/scarzbots-reference.js` (a working web bot)
hooks `WebSocket.prototype.send` and reads the URL out of the real game client
running in the same browser. Mobile services do the equivalent on-device.

## Next action
Capture the mobile client's URL via iPhone→Mac RVI (see README "THE NEXT STEP").
Then fill in `REGION_SERVERS` in `bot-engine/resolver.js`. That's the only edit.

## What the ScarzBots script taught us (already applied to the code)
Before it, the protocol implementation was wrong and would have failed even with
a valid URL:
- Connection is **encrypted** — XOR with rotating key, none of which we had
- Packet 241 carries `decryptionKey` + `serverVersion`; 242 signals spawn
- `encryptionKey = murmur2(serverPath + serverVersion, 255)`
- Move packets carry `decryptionKey` as the 3rd field (we were writing 0)
- Opcode 255 wraps LZ4-compressed data
- Cell flags: `flags & 128` → extended byte; `ext & 1` = pellet, `ext & 2` = friend
- clientVersion is **31116**, not the old 154669603

## Architecture decision
Region + UID are primary; party link optional. Confirmed this is how working
mobile services take input — bots join the region's server and locate the player
by UID on the map rather than resolving a party.

## Things not to retry
- Guessing endpoint paths on configs/configs-web (403 at CDN edge, all paths)
- DNS-guessing game server hostnames (848 shapes tried, 0 hits)
- `agario-client` npm package — author retired it; game moved to a VM-based client
- Web agar.io endpoints — separate infrastructure from mobile, not interchangeable

## Deployment
Railway project `agario-bots` (0be9f529-dcc5-474a-9779-27a7b1c91446):
- `bot-engine` — rootDir `bot-engine`, `node index.js`
- `website` — rootDir `website`, vite preview
- `party-probe` — scratch service for running diagnostic scripts
All auto-deploy from `main` on this repo.

## Scale warning
Start ~20 bots, not 450. The best public protocol-23 project couldn't exceed
~150/server *with* proxies, and lists Miniclip IP-bans as unsolved. Railway is a
single IP.
