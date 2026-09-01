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
        debug: DEBUG,
      }));
      return;
    }

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
    if (!cppReady) {
      console.error("[entry] WebSocket upgrade rejected — C++ server not ready");
      socket.destroy();
      return;
    }

    // Enforce connection limit (OOM prevention)
    if (activeConn >= MAX_CONN) {
      console.error("[entry] Max connections reached, rejecting");
      socket.destroy();
      return;
    }

    const client = net.connect(CPP_PORT, "localhost", () => {
      activeConn++;
      totalUpgrades++;
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

    // Shared cleanup: decrement counter and destroy both sockets
    const cleanup = () => {
      activeConn = Math.max(0, activeConn - 1);
      socket.destroy();
      client.destroy();
    };

    client.on("error", (err) => {
      console.error("[entry] WebSocket proxy to C++ failed:", err.message);
      cleanup();
    });
    socket.on("error", cleanup);

    // Clean up on close events too (catches remote disconnect)
    socket.on("close", cleanup);
    client.on("close", cleanup);

    // Idle timeout: kill zombie connections after 5 minutes
    const idleTimer = setTimeout(() => {
      console.error("[entry] Idle connection timeout, closing");
      cleanup();
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
      // Lightweight keepalive — minimal info
      console.log(`[mem] rss=${rssMB}MB heap=${heapMB}MB conn=${activeConn}/${MAX_CONN}`);
    }
  }, 20000);
};

startProxy();