/**
 * Production entry point.
 * Serves the Next.js frontend on Render's PORT and proxies
 * WebSocket game connections to the C++ server on :8081.
 */
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const path = require("path");
const fsBoot = require("fs");

const RENDER_PORT = parseInt(process.env.PORT || "8080", 10);
const CPP_PORT = 8081;

// Track upstream status for the /status endpoint
let cppReady = false;
let nextReady = false;
let cppExitCode = null;
let cppExitSignal = null;
let cppRestarts = 0;
let cppLastExitAt = null;
let shuttingDown = false;

// Connection management (OOM prevention)
const MAX_CONN = parseInt(process.env.MAX_CONN || "50", 10);
let activeConn = 0;

// Debug mode (set DEBUG=true to enable 20s debug output)
const DEBUG = process.env.DEBUG === "true";
let totalRequests = 0;
let totalUpgrades = 0;

/**
 * Full user-agent, verbatim. Only whitespace is collapsed (a header may span
 * folded lines), never truncated — an 80-char cap used to cut real browser
 * strings in half ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537…"
 * loses the Chrome/Safari version, which is the part you need to tell players
 * from bots), and it made the log useless for attributing traffic. Node caps a
 * header at --max-header-size (16 KB) anyway, and both audit maps are cleared
 * every 60 s, so printing the whole thing cannot grow without bound.
 */
function normalizeUa(value) {
  return String(value || "-").replace(/\s+/g, " ");
}

// ── HTTP audit log ────────────────────────────────────────────────────
// Real gameplay traffic is 100% WebSocket (an upgrade + binary frames never
// passes through the HTTP request handler). EVERY plain-HTTP response this
// process emits is therefore non-game traffic: Render health probes,
// UptimeRobot pings, stray browsers/crawlers, curl. Each response is counted
// and ONE aggregated line is printed per minute — which path was hit, the
// status sent, where it was routed, and WHO asked (user-agent) — so the log
// shows both the problem (HTTP that shouldn't exist) and where it went.
const httpAudit = new Map(); // "METHOD path → status via … | ua=…" → count
let httpAuditMinute = 0;
let httpResponsesTotal = 0; // cumulative since boot, for the 20s status line

function auditHttpResponse(req, statusCode, via) {
  httpAuditMinute++;
  httpResponsesTotal++;
  const ua = normalizeUa(req.headers["user-agent"]);
  const key = `${req.method} ${req.url} → ${statusCode} via ${via} | ua=${ua}`;
  httpAudit.set(key, (httpAudit.get(key) || 0) + 1);
}

// ── WebSocket (101) audit log ─────────────────────────────────────────
// A WebSocket handshake IS an HTTP exchange: one request in, one
// `101 Switching Protocols` response out. Any counter in front of this
// process (Render's proxy, a CDN, an uptime service) bills it as an HTTP
// response — but this process never builds an http.ServerResponse for it,
// because `upgrade` events are piped straight to the C++ server as raw TCP.
// That is exactly why handshakes were invisible in the log while the
// platform's HTTP-response counter kept climbing: every connect, every
// reconnect after an AFK kick / crash / spin-down, is one more 101 that the
// old audit could not see.
// So upgrades get the same treatment as plain HTTP: counted, attributed
// (path + user-agent + source IP) and reported as ONE aggregated line per
// minute, with how long each socket lived and why it ended. A socket that
// dies young and comes straight back is reconnect churn — the thing that
// turns "1 HTTP response per player" into hundreds per day.
const wsAudit = new Map(); // "path | ua | ip | end" → { n, totalMs, minMs, maxMs }
let wsAuditMinute = 0;
let wsOpenedTotal = 0;
let wsClosedTotal = 0;
let wsRejectedTotal = 0;

function auditWsClose(url, ua, ip, reason, lifetimeMs) {
  wsAuditMinute++;
  wsClosedTotal++;
  const key = `${url || "/"} | ua=${ua} | ip=${ip} | end=${reason}`;
  const rec = wsAudit.get(key) || { n: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
  rec.n++;
  rec.totalMs += lifetimeMs;
  rec.minMs = Math.min(rec.minMs, lifetimeMs);
  rec.maxMs = Math.max(rec.maxMs, lifetimeMs);
  wsAudit.set(key, rec);
}

function auditWsReject(url, ua, ip, reason) {
  wsAuditMinute++;
  wsRejectedTotal++;
  const key = `${url || "/"} | ua=${ua} | ip=${ip} | end=${reason}`;
  const rec = wsAudit.get(key) || { n: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
  rec.n++;
  wsAudit.set(key, rec);
}

setInterval(() => {
  if (httpAuditMinute > 0) {
    const detail = [...httpAudit.entries()].map(([k, n]) => `${n}× ${k}`).join(" | ");
    console.log(
      `[http-audit] ⚠ ${httpAuditMinute} plain-HTTP response(s) in the last 60s — ` +
      `gameplay is WebSocket-only, so this is external traffic; act on the sources below. ` +
      `Where it went: ${detail}`,
    );
    httpAudit.clear();
    httpAuditMinute = 0;
  }
  if (wsAuditMinute > 0) {
    // Each entry here is one `101` response the platform counted. `life=` is
    // how long the socket stayed up: a low value repeated many times means
    // clients are reconnecting in a loop (AFK kick, C++ restart, spin-down),
    // and each of those reconnects costs another handshake.
    const detail = [...wsAudit.entries()]
      .map(([k, r]) =>
        `${r.n}× ${k}` +
        (r.totalMs > 0
          ? ` | life=${(r.totalMs / r.n / 1000).toFixed(0)}s avg` +
            ` (${r.minMs === Infinity ? 0 : (r.minMs / 1000).toFixed(0)}–${(r.maxMs / 1000).toFixed(0)}s)`
          : ""),
      )
      .join(" | ");
    console.log(
      `[ws-audit] ${wsAuditMinute} WebSocket handshake(s)/close(s) in the last 60s ` +
      `(each handshake = 1 HTTP \`101\` response, live=${activeConn}, ` +
      `opened=${wsOpenedTotal} closed=${wsClosedTotal} rejected=${wsRejectedTotal} since boot): ${detail}`,
    );
    wsAudit.clear();
    wsAuditMinute = 0;
  }
}, 60_000);

// ── 1. Start the C++ game server on :8081 (supervised) ────────────────
// The C++ process can die (crash / OOM kill). Previously nothing restarted
// it, so the game stayed down until the whole container was redeployed.
// It is now supervised with exponential backoff.
const CPP_BIN = path.join(__dirname, "petalia-server");
const CPP_RESTART_MIN_MS = 1000;
const CPP_RESTART_MAX_MS = 30000;
let cppProc = null;
let cppRestartDelay = CPP_RESTART_MIN_MS;

function scheduleCppRestart() {
  if (shuttingDown) return;
  const delay = cppRestartDelay;
  cppRestartDelay = Math.min(cppRestartDelay * 2, CPP_RESTART_MAX_MS);
  console.error(`[entry] restarting petalia-server in ${delay}ms (restarts=${cppRestarts})`);
  setTimeout(startCpp, delay).unref?.();
}

function startCpp() {
  if (shuttingDown) return;
  console.log(`[entry] starting petalia-server (${CPP_BIN})`);
  const proc = spawn(CPP_BIN, [], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(CPP_PORT) },
  });
  cppProc = proc;

  // Reset the backoff once the process has stayed alive for a while.
  const stableTimer = setTimeout(() => {
    if (cppProc === proc) cppRestartDelay = CPP_RESTART_MIN_MS;
  }, 60000);
  stableTimer.unref?.();

  proc.on("exit", (code, signal) => {
    clearTimeout(stableTimer);
    cppExitCode = code;
    cppExitSignal = signal;
    cppLastExitAt = new Date().toISOString();
    cppReady = false;
    cppRestarts++;
    console.error(
      `[entry] petalia-server exited (code=${code} signal=${signal})` +
      (signal === "SIGKILL" ? " — likely OOM-killed" : "")
    );
    if (cppProc === proc) cppProc = null;
    scheduleCppRestart();
  });

  proc.on("error", (err) => {
    console.error(`[entry] petalia-server failed to spawn: ${err.message} (path=${CPP_BIN})`);
    if (err.code === "ENOENT" || err.code === "EACCES") {
      // Binary missing/not executable — a restart loop won't help much, but
      // keep retrying slowly so a fixed image/volume recovers on its own.
      cppRestartDelay = CPP_RESTART_MAX_MS;
    }
    if (cppProc === proc) {
      cppProc = null;
      cppReady = false;
      cppRestarts++;
      scheduleCppRestart();
    }
  });
}

if (!fsBoot.existsSync(CPP_BIN)) {
  console.error(`[entry] FATAL: ${CPP_BIN} not found — WebSocket game server cannot start`);
}
startCpp();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    shuttingDown = true;
    try { cppProc?.kill(sig); } catch {}
    process.exit(0);
  });
}

// ── 2. Start the Next.js standalone server ────────────────────────────
const nextServerPath = path.join(__dirname, "nextjs", "server.js");
const nextServerCwd = path.join(__dirname, "nextjs");

// Pre-flight: verify the standalone server file exists before spawning.
// This gives a clear, actionable error instead of a silent spawn failure.
const fs = require("fs");
console.log(`[entry] Next.js binary: ${nextServerPath}`);
console.log(`[entry] Next.js cwd:    ${nextServerCwd}`);
console.log(`[entry] __dirname contents: ${fs.readdirSync(__dirname).join(", ")}`);
if (fs.existsSync(nextServerCwd)) {
  try {
    console.log(`[entry] nextjs/ contents: ${fs.readdirSync(nextServerCwd).join(", ")}`);
  } catch (e) {
    console.error(`[entry] cannot read nextjs/: ${e.message}`);
  }
} else {
  console.error(`[entry] FATAL: nextjs/ directory does not exist — npm run build likely failed`);
}
if (!fs.existsSync(nextServerPath)) {
  console.error(`[entry] FATAL: ${nextServerPath} not found — cannot start Next.js`);
}

const nextServer = spawn("node", ["--max-old-space-size=256", nextServerPath], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: "3080", HOSTNAME: "0.0.0.0" },
  cwd: nextServerCwd,
});

// Forward Next.js stdout/stderr to our logs with a clear prefix.
nextServer.stdout.on("data", (buf) => {
  process.stdout.write(`[next] ${buf}`);
});
nextServer.stderr.on("data", (buf) => {
  process.stderr.write(`[next] ${buf}`);
});

nextServer.on("exit", (code, signal) => {
  nextReady = false;
  console.error(`[entry] Next.js server exited with code=${code} signal=${signal} — exiting to trigger Render restart`);
  setImmediate(() => process.exit(code || 1));
});
nextServer.on("error", (err) => {
  console.error(`[entry] Next.js server failed to spawn: ${err.message} (path=${nextServerPath}, cwd=${nextServerCwd})`);
});

// ── 3. Health check helper: wait for a TCP port to be ready ───────────
function waitForPort(port, host, retries = 30, delay = 500) {
  let attempts = 0;
  return new Promise((resolve, reject) => {
    const check = () => {
      const sock = new net.Socket();
      sock.setTimeout(1000);
      let done = false;
      // Register ALL handlers BEFORE connect() to avoid race conditions
      sock.on("connect", () => {
        done = true;
        sock.destroy();
        resolve();
      });
      sock.on("error", () => { if (!done) { sock.destroy(); } });
      sock.on("timeout", () => { if (!done) { sock.destroy(); } });
      sock.on("close", () => {
        if (done) return;
        attempts++;
        if (attempts >= retries) reject(new Error(`port ${port} not ready`));
        else setTimeout(check, delay);
      });
      sock.connect(port, host);
    };
    check();
  });
}

// Check if a TCP port is currently accepting connections
function checkPort(port, host) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1000);
    let done = false;
    sock.on("connect", () => { done = true; sock.destroy(); resolve(true); });
    sock.on("error", () => { if (!done) { sock.destroy(); resolve(false); } });
    sock.on("timeout", () => { if (!done) { sock.destroy(); resolve(false); } });
    sock.connect(port, host);
  });
}

// ── 4. Wait for both servers, then start proxy ────────────────────────
const startProxy = async () => {
  // Wait for Next.js (required for HTTP)
  try {
    await waitForPort(3080, "localhost", 60);
    nextReady = true;
    console.log("[entry] Next.js ready on :3080");
  } catch (e) {
    console.error("[entry] Next.js not ready:", e.message);
  }

  // Wait for C++ server (optional — WebSocket only)
  try {
    await waitForPort(CPP_PORT, "localhost");
    cppReady = true;
    console.log("[entry] C++ game server ready on :8081");
  } catch (e) {
    console.error("[entry] C++ game server not ready:", e.message);
  }

  console.log("[entry] Starting proxy...");

  const proxy = http.createServer((req, res) => {
    totalRequests++;

    // HTTP audit (see block near the top of this file) — fires when the
    // response is actually flushed. WebSocket upgrades never reach this
    // handler, so everything counted here is genuine plain-HTTP traffic.
    let proxyVia = "entry(direct answer)";
    let httpAudited = false;
    const auditOnce = () => {
      if (httpAudited) return;
      httpAudited = true;
      auditHttpResponse(req, res.statusCode, proxyVia);
    };
    res.on("finish", auditOnce);
    // A caller that hangs up mid-response (bot, `curl -m 1`, closed tab) never
    // fires `finish` — without `close` those responses go uncounted.
    res.on("close", auditOnce);

    // ── /status endpoint for debugging ────────────────────────────────
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: cppReady && nextReady,
        next: nextReady,
        cpp: cppReady,
        cppExitCode: cppExitCode,
        cppExitSignal: cppExitSignal,
        cppRestarts: cppRestarts,
        cppLastExitAt: cppLastExitAt,
        uptime: process.uptime(),
      }));
      return;
    }

    // ── /debug endpoint (full server state, lightweight) ──────────────
    if (req.url === "/debug") {
      const mem = process.memoryUsage();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: cppReady && nextReady,
        next: nextReady,
        cpp: cppReady,
        cppExitCode: cppExitCode,
        cppExitSignal: cppExitSignal,
        cppRestarts: cppRestarts,
        cppLastExitAt: cppLastExitAt,
        uptime: process.uptime(),
        pid: process.pid,
        memory: {
          rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
          heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
          heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        },
        connections: { active: activeConn, max: MAX_CONN, totalUpgrades },
        requests: { total: totalRequests },
        // Cumulative since boot, mirroring the [http-audit] / [ws-audit] lines.
        // Render's own Metrics page counts HTTP responses at ITS proxy (per host
        // + status code), so its number also includes the `101` handshakes and
        // the 502/503 its edge replies with while this container is asleep —
        // neither of which ever reaches an HTTP handler here. These counters are
        // what THIS process actually emitted, so comparing the two tells you how
        // much of Render's curve is your traffic and how much is the edge.
        responses: {
          plainHttp: httpResponsesTotal,
          wsHandshakes: wsOpenedTotal, // each one = a `101` response
          wsClosed: wsClosedTotal,
          wsRejected: wsRejectedTotal,
        },
        debug: DEBUG,
      }));
      return;
    }

    // Every other plain-HTTP request is proxied to Next.js.
    proxyVia = "proxy→Next.js:3080";
    const options = {
      hostname: "localhost",
      port: 3080,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", () => {
      res.writeHead(502);
      res.end("Bad Gateway");
    });
    req.pipe(proxyReq);
  });

  // WebSocket upgrade: proxy to the C++ server via raw TCP
  proxy.on("upgrade", (req, socket, head) => {
    // Attribution for the [ws-audit] line: who is opening (and re-opening)
    // sockets. `x-forwarded-for` is set by Render's proxy, so this is the real
    // client IP — that is how you tell players from bots/uptime monitors.
    const ua = normalizeUa(req.headers["user-agent"]);
    const ip =
      String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      socket.remoteAddress ||
      "-";
    const openedAt = Date.now();

    if (!cppReady) {
      console.error("[entry] WebSocket upgrade rejected — C++ server not ready");
      auditWsReject(req.url, ua, ip, "rejected(cpp-not-ready)");
      socket.destroy();
      return;
    }

    // Enforce connection limit (OOM prevention)
    if (activeConn >= MAX_CONN) {
      console.error("[entry] Max connections reached, rejecting");
      auditWsReject(req.url, ua, ip, "rejected(server-full)");
      socket.destroy();
      return;
    }

    let client = null;
    let idleTimer = null;
    let ended = false;
    let counted = false;

    // Single guarded teardown. Previously every one of the four listeners
    // below ran the same cleanup, so `activeConn` was decremented up to four
    // times per connection (and the idle timer kept firing after the socket
    // was already gone). The clamp at 0 hid it, which is why the 20s line
    // reported `conn=0/50` even with players connected — the log looked idle
    // while traffic was flowing.
    const end = (reason) => {
      if (ended) return;
      ended = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (counted) activeConn = Math.max(0, activeConn - 1);
      auditWsClose(req.url, ua, ip, reason, Date.now() - openedAt);
      try { socket.destroy(); } catch { /* ignore */ }
      try { client?.destroy(); } catch { /* ignore */ }
    };

    client = net.connect(CPP_PORT, "localhost", () => {
      if (ended) return;
      if (!counted) {
        counted = true;
        activeConn++;
      }
      totalUpgrades++;
      wsOpenedTotal++;
      const reqLine = `GET ${req.url} HTTP/1.1\r\n`;
      const headers = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      client.write(reqLine + headers + "\r\n\r\n");
      if (head && head.length > 0) client.write(head);

      // Bidirectional pipe with proper cleanup
      socket.pipe(client);
      client.pipe(socket);
    });

    client.on("error", (err) => {
      console.error("[entry] WebSocket proxy to C++ failed:", err.message);
      end(`upstream-error(${err.code || "err"})`);
    });
    socket.on("error", (err) => end(`client-error(${err.code || "err"})`));

    // Clean up on close events too (catches remote disconnect)
    socket.on("close", () => end("client-close"));
    client.on("close", () => end("upstream-close"));

    // Idle timeout: kill zombie connections after 5 minutes of silence in
    // BOTH directions. The C++ server pushes STATS/DEBUG to every connected
    // client (even one sitting in the main menu), so a healthy socket keeps
    // refreshing this; only a truly dead peer trips it.
    idleTimer = setTimeout(() => {
      console.error("[entry] Idle connection timeout, closing");
      end("idle-timeout(5m)");
    }, 5 * 60 * 1000);
    socket.on("data", () => { idleTimer.refresh(); });
    client.on("data", () => { idleTimer.refresh(); });
  });

  proxy.listen(RENDER_PORT, () => {
    console.log(`[entry] listening on :${RENDER_PORT} → Next.js :3080 / C++ :${CPP_PORT}`);
  });

  // ── Periodic health check: re-check C++ server every 15s ────────────
  setInterval(async () => {
    const alive = await checkPort(CPP_PORT, "localhost");
    if (alive !== cppReady) {
      cppReady = alive;
      console.log(`[entry] C++ server status changed: ${alive ? "up" : "down"}`);
    }
  }, 3000);

  // ── Debug / status output every 20 seconds ──────────────────────────
  setInterval(() => {
    const mem = process.memoryUsage();
    const rssMB = (mem.rss / 1024 / 1024).toFixed(0);
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0);

    if (DEBUG) {
      // Full debug dump — includes all server state
      console.log(
        `[debug] ` +
        `mem=${rssMB}/${heapMB}MB ` +
        `conn=${activeConn}/${MAX_CONN} ` +
        `total=${totalRequests}req ${totalUpgrades}ws ` +
        `cpp=${cppReady ? "up" : "down"}(r${cppRestarts}) ` +
        `next=${nextReady ? "up" : "down"} ` +
        `uptime=${(process.uptime() / 60).toFixed(1)}min`
      );
    } else {
      // Lightweight keepalive — minimal info, but always with the traffic
      // counters: `http=` is plain-HTTP responses this process emitted since
      // boot, `ws=` is completed WebSocket handshakes (each one a `101`
      // response that never appears in the plain-HTTP count). Watching which
      // of the two deltas over a few minutes tells you immediately whether the
      // platform's HTTP-response counter is being fed by external HTTP or by
      // reconnecting sockets.
      console.log(
        `[mem] rss=${rssMB}MB heap=${heapMB}MB conn=${activeConn}/${MAX_CONN} ` +
        `http=${httpResponsesTotal} ws=${wsOpenedTotal}/${wsClosedTotal}(rej ${wsRejectedTotal}) ` +
        `req=${totalRequests}`,
      );
    }
  }, 20000);
};

startProxy();