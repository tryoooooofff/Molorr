/**
 * Production entry point.
 * Serves the Next.js frontend on Render's PORT and proxies
 * WebSocket game connections to the C++ server on :8081.
 */
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const path = require("path");

const RENDER_PORT = parseInt(process.env.PORT || "8080", 10);
const CPP_PORT = 8081;

// Track upstream status for the /status endpoint
let cppReady = false;
let nextReady = false;
let cppExitCode = null;

// ── 1. Start the C++ game server on :8081 ─────────────────────────────
const cpp = spawn(path.join(__dirname, "petalia-server"), [], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(CPP_PORT) },
});
cpp.on("exit", (code) => {
  cppExitCode = code;
  cppReady = false;
  console.error(`[entry] petalia-server exited with code ${code}`);
  // Don't kill the whole process — let the proxy keep serving 502s
  // so the container stays alive for debugging.
});
cpp.on("error", (err) => {
  console.error("[entry] petalia-server failed to spawn:", err.message);
});

// ── 2. Start the Next.js standalone server ────────────────────────────
const nextServer = spawn("node", [path.join(__dirname, "nextjs", "server.js")], {
  stdio: "inherit",
  env: { ...process.env, PORT: "3080", HOST: "0.0.0.0" },
  cwd: path.join(__dirname, "nextjs"),
});
nextServer.on("exit", (code) => {
  nextReady = false;
  console.error(`[entry] Next.js server exited with code ${code}`);
});
nextServer.on("error", (err) => {
  console.error("[entry] Next.js server failed to spawn:", err.message);
});

// ── 3. Health check helper: wait for a TCP port to be ready ───────────
function waitForPort(port, host, retries = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    let done = false;
    const check = () => {
      if (done) return;
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.on("connect", () => {
        done = true;
        sock.destroy();
        resolve();
      });
      sock.on("error", () => { sock.destroy(); });
      sock.on("timeout", () => { sock.destroy(); });
      sock.connect(port, host);
      sock.on("close", () => {
        if (done) return;
        attempts++;
        if (attempts >= retries) reject(new Error(`port ${port} not ready`));
        else setTimeout(check, delay);
      });
    };
    check();
  });
}

// Check if a TCP port is currently accepting connections
function checkPort(port, host) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1000);
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("error", () => { sock.destroy(); resolve(false); });
    sock.on("timeout", () => { sock.destroy(); resolve(false); });
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
    // ── /status endpoint for debugging ────────────────────────────────
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: cppReady && nextReady,
        next: nextReady,
        cpp: cppReady,
        cppExitCode: cppExitCode,
        uptime: process.uptime(),
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
    const client = net.connect(CPP_PORT, "localhost", () => {
      const reqLine = `GET ${req.url} HTTP/1.1\r\n`;
      const headers = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      client.write(reqLine + headers + "\r\n\r\n");
      if (head && head.length > 0) client.write(head);
      client.pipe(socket).pipe(client);
    });
    client.on("error", (err) => {
      console.error("[entry] WebSocket proxy to C++ failed:", err.message);
      try { socket.destroy(); } catch {}
    });
    socket.on("error", () => { try { client.destroy(); } catch {} });
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
  }, 15000);
};

startProxy();