# Petalia.io — a florr.io-like arena (canvas2d client + binary WS server)

Everything you see is drawn with **canvas2d** — main menu, account panel, HUD, bag,
crafting panel, drag & drop cards, mobs, petals, walls. There is no DOM/CSS UI.

## The two main files

| File | Role |
| --- | --- |
| `server/index.ts` | **Server main.** Standalone authoritative WebSocket server (binary `Uint8Array` frames), 20 ticks/s. |
| `src/game/client/game.ts` | **Client main.** Full canvas2d renderer + UI + input + netcode. |

Shared code (used by *both* sides, so the browser can host an offline server too):

* `src/game/shared/defs.ts` — items, rarities, mobs, the 3 maps and their walls.
* `src/game/shared/protocol.ts` — binary `Writer`/`Reader`, packet ids.
* `src/game/shared/sim.ts` — the authoritative simulation (movement, collision boxes,
  petals, summons, loot, xp, crafting).
* `src/game/client/transport.ts` — `RemoteTransport` (WebSocket) or `LocalTransport`
  (runs `GameServer` inside the browser when no server URL is configured).

## Gameplay

* **3 maps**: Garden, Desert, Ocean — different mobs, walls, loot rarity bias. Switch
  in-game with the buttons at the bottom right (animated flash + fresh world load).
* **Petals** orbit your flower: hold **left mouse** to expand (attack), **right mouse /
  space** to contract (defend).
* **Summon items**: `Egg` hatches a friendly Ladybug, `Stick` calls a Wasp. Equip them in a
  petal slot. Mobs killed **by your friendly pets still drop cards and give you XP**
  (kills are credited through `lastHitBy` → pet owner).
* **Drops** are cards on the floor; walk over them, they fly into your bag.
* **Crafting**: open the craft panel (`C`), drag a card into it, 5 identical cards combine
  into one of the next rarity (success chance drops with rarity, animated spin).
* **Bag** (`E` / Inventory button) slides up; drag cards from the bag onto the 8 petal
  slots (or back) — the swap is validated by the server.
* Collision boxes for players, mobs and every wall rectangle.

Controls: `WASD` / arrows move · left mouse attack · right mouse (or space) defend ·
`E` bag · `C` craft · `Esc` back to menu.

## Accounts

* **Guest** — progress (petals, bag, XP, map) is stored in `localStorage`.
* **Register / Log in** on the Account tab — accounts live in PostgreSQL
  (`users`, `saves` tables via Drizzle) and the save syncs every few seconds
  (`/api/auth/register`, `/api/auth/login`, `/api/save`).

## Running

```bash
npm install
npx drizzle-kit push --config drizzle.config.json   # create users/saves tables
npm run dev                                          # web client on :3000
```

Without extra config the client boots `LocalTransport`, i.e. the *real* server
simulation runs in your browser tab — perfect for testing.

### Hosting the game server for real (free tiers)

```bash
npx tsx server/index.ts       # listens on $PORT (default 8080), /health for probes
```

Deploy that single process to Fly.io / Railway / Render / Koyeb, then build the web
client with:

```
NEXT_PUBLIC_GAME_WS=wss://your-server-host
```

The client will connect over WebSocket and render everything itself; only binary
`Uint8Array` snapshots travel over the wire.

### GitHub

```bash
git init && git add . && git commit -m "petalia.io"
git branch -M main
git remote add origin git@github.com:<you>/petalia.git
git push -u origin main
```

## Wire protocol (byte-exact, easy to port to C++)

All packets are raw binary, big-endian, first byte = packet id.

**Client → Server**

| id | name | payload |
| -- | ---- | ------- |
| 1 | JOIN | `str name`, `u8 mapId`, `u32 xp`, 8×cell, `u8 bagCount`, n×cell |
| 2 | INPUT | `i8 dx*100`, `i8 dy*100`, `u8 flags` (1=attack, 2=defend) |
| 3 | SWAP | `u8 from`, `u8 to` (0..7 = petal slots, 8+ = bag) |
| 4 | CRAFT | `u8 itemId`, `u8 rarity`, `u16 count` (normal craft always sends `5`) |
| 5 | CHANGE_MAP | `u8 mapId` |
| 6 | RESPAWN | — |
| 7 | PING | `u32 stamp` |

`cell` = `u8 itemId (255 = empty)`, `u8 rarity`, `u16 count`.
`str` = `u8 length` + ASCII bytes.

**Server → Client**

| id | name | payload |
| -- | ---- | ------- |
| 1 | WELCOME | `u16 playerId`, `u8 mapId`, `u16 w`, `u16 h`, `u16 wallCount`, walls(`u16 x,y,w,h`) |
| 2 | SNAPSHOT | `u32 tick`, `u16 count`, entities |
| 3 | INVENTORY | `u8 8`, 8×cell, `u8 32`, 32×cell |
| 4 | STATS | `u32 xp`, `u16 level`, `u16 hp`, `u16 maxHp`, `u8 mapId`, `u8 alive` |
| 5 | EVENT | `u8 kind`, `i16 x`, `i16 y`, `u32 value`, `u8 item`, `u8 rarity` |
| 6 | PONG | `u32 stamp` |

entity = `u8 kind` (0 player, 1 mob, 2 petal, 3 drop), `u16 id`, `u8 type`,
`u8 team` (0 hostile, 1 friendly, 2 self — for drops this field carries the rarity),
`i16 x`, `i16 y`, `u16 angle/65535`, `u8 radius`, `u8 hp*255`,
then `str name` if player, `u8 rarity` if mob.

## C++ server

`server-cpp/main.cpp` contains a compile-ready skeleton (uWebSockets) with the same
packet writer/reader so you can port `src/game/shared/sim.ts` one-to-one when you want
maximum performance; the TypeScript server stays the reference implementation and both
speak the identical byte format, so the client needs no changes.
