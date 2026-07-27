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
import { WebSocketServer, WebSocket } from "ws";
import { GameServer } from "../src/game/shared/sim";
import { AFK_CLOSE_CODE, AFK_CLOSE_REASON, TICK_MS } from "../src/game/shared/defs";

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS = Number(process.env.GAME_MAX_PLAYERS || 8);
const MOB_CAP_SCALE = Number(process.env.GAME_MOB_CAP_SCALE || 0.5);
const game = new GameServer({ mobCapScale: MOB_CAP_SCALE });
let nextClientId = 1;

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("petalia game server");
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
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    game.tick(dt);
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
