/**
 * WebSocket keepalive — replaces the old HTTP ping cron.
 * ------------------------------------------------------------------
 * Render free-tier services spin down when idle. That used to be prevented
 * by `curl`-ing the HTTP endpoints every 14 minutes, which cost ~204 HTTP
 * responses/day — and half of those hit a hostname that no longer exists.
 * This script does the same job with **zero HTTP responses**:
 *
 *   • ONE WebSocket handshake per server per session (the `101` upgrade),
 *     then nothing but zero-payload PING control frames on an open socket.
 *
 * WHY IT SURVIVES INDEFINITELY
 * ----------------------------
 * The client deliberately never sends C2S.JOIN. A client is only turned into
 * a player by JOIN, and the AFK sweep explicitly skips clients with no
 * player:
 *
 *   src/game/shared/sim.ts:2045   if (!c.player || c.kick) continue;
 *   (server-cpp/main.cpp does the same — spawnPlayer only runs on JOIN)
 *
 * so an unjoined socket is never AFK-kicked (verified: a control run with no
 * traffic at all survived 245 s of simulated time, while a JOINed client is
 * kicked at AFK_IDLE_SECONDS + AFK_CHECK_SECONDS = 225 s). It therefore:
 *   • holds no player slot and is invisible to other players,
 *   • receives no state snapshots (unspawned players are skipped),
 *   • cannot be AFK-disconnected.
 *
 * The periodic PING is *not* for the game's AFK timer — it exists so that no
 * intermediary (proxy, load balancer, NAT) tears down a silent connection.
 * It is an RFC 6455 control frame with no payload, so it never reaches the
 * game's packet parser. The bundled proxy at entry.js also refreshes its own
 * 5-minute idle timer on any inbound data (entry.js:322).
 *
 * USAGE
 *   node scripts/ws-keepalive.mjs                      # run forever
 *   node scripts/ws-keepalive.mjs --once               # one short probe, then exit
 *   node scripts/ws-keepalive.mjs --minutes=15         # run N minutes, then exit
 *   node scripts/ws-keepalive.mjs wss://host:8081      # override the target list
 *
 * `--minutes` exists for the scheduled job in .github/workflows/keepalive.yml:
 * each run slightly outlasts the cron interval so one connection is always
 * open, which is what keeps the instance from spinning down.
 *
 * ENV
 *   KEEPALIVE_PING_MS    milliseconds between PINGs   (default 60000)
 *   KEEPALIVE_ONCE_MS    probe duration for --once    (default 8000)
 */
import WebSocket from "ws";

const DEFAULT_URLS = [
  "wss://molorr-server-t34o.onrender.com",
  "wss://molorr-server-sg.onrender.com",
];

const PING_MS = Number(process.env.KEEPALIVE_PING_MS || 60_000);
const ONCE_MS = Number(process.env.KEEPALIVE_ONCE_MS || 8_000);
const CONNECT_TIMEOUT_MS = 30_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 120_000;

const argUrls = process.argv.slice(2).filter((a) => a.startsWith("ws://") || a.startsWith("wss://"));
const URLS = argUrls.length > 0 ? argUrls : DEFAULT_URLS;
const ONCE = process.argv.includes("--once");
const MINUTES_ARG = Number(
  (process.argv.find((a) => a.startsWith("--minutes=")) || "").split("=")[1] || 0,
);
const DURATION_MS = MINUTES_ARG > 0 ? MINUTES_ARG * 60_000 : 0;

const log = (...a) => console.log(`[keepalive] ${new Date().toISOString()} ...`, ...a);

let stopping = false;

/** One supervised connection to one server. Reconnects with backoff. */
function supervise(url) {
  let ws = null;
  let pingTimer = null;
  let connectTimer = null;
  let backoff = BACKOFF_MIN_MS;
  let pingsOut = 0;
  let framesIn = 0;

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (connectTimer) clearTimeout(connectTimer);
    pingTimer = null;
    connectTimer = null;
  };

  const sendPing = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Zero-payload PING control frame: keeps intermediaries from idling the
    // socket out without producing a single game packet.
    ws.ping();
    pingsOut++;
  };

  const retry = () => {
    if (stopping) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    log(`${url} reconnecting in ${delay}ms`);
    setTimeout(connect, delay);
  };

  function connect() {
    if (stopping) return;
    log(`${url} connecting`);
    try {
      ws = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS, perMessageDeflate: false });
    } catch (err) {
      log(`${url} construct failed: ${err.message}`);
      return retry();
    }
    ws.binaryType = "arraybuffer";

    connectTimer = setTimeout(() => {
      log(`${url} handshake timed out after ${CONNECT_TIMEOUT_MS}ms`);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(connectTimer);
      connectTimer = null;
      // A successful connect means the instance is up: reset the backoff.
      backoff = BACKOFF_MIN_MS;
      log(`${url} connected — PING every ${PING_MS}ms (no JOIN, no game packets)`);
      sendPing();
      pingTimer = setInterval(sendPing, PING_MS);
    });

    ws.on("message", (data) => {
      framesIn++;
      // Expected to stay 0: an unjoined client is never spawned, so the
      // server has no snapshot to send it. Anything here is worth logging.
      log(`${url} inbound frame #${framesIn}: ${data.length} bytes`);
    });

    ws.on("close", (code, reason) => {
      clearTimers();
      log(
        `${url} closed (code=${code}${reason ? ` "${reason}"` : ""}) ` +
          `after ${pingsOut} pings / ${framesIn} frames in`,
      );
      retry();
    });

    ws.on("error", (err) => {
      log(`${url} error: ${err.message}`);
      // `close` fires next and performs the retry.
    });
  }

  connect();

  return () => {
    clearTimers();
    try {
      ws?.close(1000, "keepalive stopping");
    } catch {
      /* ignore */
    }
  };
}

const stops = URLS.map(supervise);

/** Close every socket and exit. */
function shutdown(reason) {
  // Set first: the `close` handlers fire during teardown and must not
  // schedule a reconnect.
  stopping = true;
  log(reason);
  stops.forEach((s) => s());
  setTimeout(() => process.exit(0), 500);
}

if (ONCE || DURATION_MS > 0) {
  const ms = ONCE ? ONCE_MS : DURATION_MS;
  log(`bounded run: will exit in ${ms}ms`);
  setTimeout(() => shutdown(ONCE ? `--once: done after ${ms}ms` : `--minutes=${MINUTES_ARG}: done`), ms);
} else {
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      stopping = true;
      shutdown(`${sig} received, closing sockets`);
    });
  }
  log(`watching ${URLS.length} server(s), ping ${PING_MS}ms, HTTP requests: 0`);
}
