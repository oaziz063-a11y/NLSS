# Agario Bot System

Personal feeder-bot system. Website control panel + Node bot engine.

## Structure
- `bot-engine/` — Node service. Resolves party key → server, spawns bots, exposes control API.
- `website/` — React control panel.

## Modes
| Mode | Behaviour |
|---|---|
| Feed me | Bots rush you and eject mass |
| Farm first | Eat pellets to grow, then feed (far more mass per bot) |
| Feed everyone | Bots die into whoever is nearest |
| Freeze | Hold position |
| Idle | Connected, inactive |

## Live controls
Mode switching, bot count scaling, split all/half, eject, force respawn — all while running.

## Env vars
**bot-engine:** `ENGINE_PASSWORD`, `MAX_BOTS`, `SPAWN_RATE`, `PORT`
**website:** `VITE_API_URL`

## Status
Party-key resolution against current Agar.io servers is unverified — see `resolver.js`.
Run `node probe.js SJPCXC` on the engine to test.
