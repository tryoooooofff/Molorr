/**
 * SERVER MAIN FILE
 * ----------------
 * Standalone authoritative game server (WebSocket, binary Uint8Array frames).
 * Deploy this anywhere that runs Node (Fly.io / Railway / Render free tier):
 *
 *   npm i ws tsx
 *   npx tsx server/index.ts            # PORT env var, defaults to 8080
 *
 * Then point the web client at it:
 *   NEXT_PUBLIC_GAME_WS=wss://your-host  (see README.md)
 *
 * The exact same simulation module is reused by the browser fallback server,
 * so gameplay is identical whether you host it or play offline.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { GameServer } from "../src/game/shared/sim";
import type { PlayerSave } from "../src/game/shared/sim";
import { AFK_CLOSE_CODE, AFK_CLOSE_REASON, TICK_MS } from "../src/game/shared/defs";

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS = Number(process.env.GAME_MAX_PLAYERS || 8);
const MOB_CAP_SCALE = Number(process.env.GAME_MOB_CAP_SCALE || 0.5);
const SAVE_FILE = process.env.GAME_SAVE_FILE || path.join(process.cwd(), "data", "player_saves.json");

// Load existing saves from disk
let savesOnDisk: Record<number, PlayerSave> = {};
try {
  if (fs.existsSync(SAVE_FILE)) {
    savesOnDisk = JSON.parse(fs.readFileSync(SAVE_FILE, "utf-8"));
    console.log(`[petalia] loaded ${Object.keys(savesOnDisk).length} player saves from disk`);
  }
} catch (err) {
  console.error("[petalia] failed to load saves:", err);
}

// Ensure data directory exists
const dir = path.dirname(SAVE_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const persistCallback = (clientId: number, save: PlayerSave) => {
  savesOnDisk[clientId] = save;
};

const game = new GameServer({ mobCapScale: MOB_CAP_SCALE, persistCallback });
let nextClientId = 1;

// HTTP on this port is reduced to nearly zero. The ONLY HTTP responses left:
//   1. the mandatory WebSocket upgrade handshake (101 Switching Protocols),
//      answered by the `ws` library itself — it never reaches this handler
//      and CANNOT be removed: RFC 6455 requires exactly one HTTP request+response
//      to open every WebSocket connection;
//   2. an empty 200 on /health so hosting-platform health probes still pass;
//   3. an empty 426 (Upgrade Required) for any other stray plain-HTTP request.
// Zero body bytes and `connection: close` — no keep-alive, each leftover HTTP
// exchange is one tiny header-only response, then the socket dies.
// Everything real (snapshots, inputs, pings) is binary WebSocket frames — no HTTP.
const httpServer = http.createServer((req, res) => {
  // All leftover HTTP exchanges are header‑only, then the socket dies.
  // Explicitly set content‑length and connection: close so that no
  // Keep‑Alive or lingering body can consume bandwidth.
  res.writeHead(req.url === "/health" ? 200 : 426, {
    "content-length": "0",
    connection: "close",
    "content-type": "text/plain",
  });
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
/** Live sockets by client id, so the AFK sweep can close the right one. */
const sockets = new Map<number, WebSocket>();

wss.on("connection", (socket: WebSocket) => {
  if (game.playerCount() >= MAX_PLAYERS) {
    socket.close(1013, "server full");
    return;
  }
  const id = nextClientId++;
  socket.binaryType = "arraybuffer";
  sockets.set(id, socket);
  game.addClient(id, (data: Uint8Array) => {
    if (socket.readyState === socket.OPEN) socket.send(data);
  });
  socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    let bytes: Uint8Array;
    if (Array.isArray(raw)) bytes = new Uint8Array(Buffer.concat(raw));
    else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    try {
      game.handleMessage(id, bytes);
    } catch (err) {
      console.error("bad packet", err);
    }
  });
  socket.on("close", () => {
    sockets.delete(id);
    game.removeClient(id);
  });
  socket.on("error", () => {
    sockets.delete(id);
    game.removeClient(id);
  });
});

let last = Date.now();
let flushTimer = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    game.tick(dt);
    // Flush saves to disk every 30 seconds
    flushTimer += dt;
    if (flushTimer >= 30) {
      flushTimer = 0;
      try {
        fs.writeFileSync(SAVE_FILE, JSON.stringify(savesOnDisk, null, 2));
      } catch (err) {
        console.error("[petalia] failed to flush saves:", err);
      }
    }
    // Players who ignored the on-screen [AFK CHECK] button are dropped here.
    // The close event runs removeClient(), so no extra cleanup is needed.
    for (const id of game.drainKicks()) {
      const socket = sockets.get(id);
      if (!socket) continue;
      console.log(`[petalia] disconnecting client ${id}: afk check expired`);
      try {
        socket.close(AFK_CLOSE_CODE, AFK_CLOSE_REASON);
      } catch {
        socket.terminate();
      }
    }
  } catch (err) {
    console.error("tick error", err);
  }
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(
    `[petalia] game server listening on :${PORT} | maxPlayers=${MAX_PLAYERS} | mobCapScale=${MOB_CAP_SCALE}`,
  );
});

// Save on shutdown
function shutdown() {
  console.log("[petalia] shutting down, saving player data...");
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(savesOnDisk, null, 2));
  } catch (err) {
    console.error("[petalia] failed to save on shutdown:", err);
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
