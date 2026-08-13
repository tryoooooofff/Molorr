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

// ── 1. Start the C++ game server on :8081 ─────────────────────────────
const cpp = spawn(path.join(__dirname, "petalia-server"), [], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(CPP_PORT) },
});
cpp.on("exit", (code) => {
  console.error(`[entry] petalia-server exited with code ${code}`);
  process.exit(code);
});

// ── 2. Start the Next.js standalone server ────────────────────────────
const nextServer = spawn("node", [path.join(__dirname, "nextjs", "server.js")], {
  stdio: "inherit",
  env: { ...process.env, PORT: "3080" },
  cwd: path.join(__dirname, "nextjs"),
});

// ── 3. Health check helper: wait for a TCP port to be ready ───────────
function waitForPort(port, host, retries = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.on("connect", () => { sock.destroy(); resolve(); });
      sock.on("error", () => { sock.destroy(); });
      sock.on("timeout", () => { sock.destroy(); });
      sock.connect(port, host);
      sock.on("close", () => {
        attempts++;
        if (attempts >= retries) reject(new Error(`port ${port} not ready`));
        else setTimeout(check, delay);
      });
    };
    check();
  });
}

// ── 4. Wait for both servers, then start proxy ────────────────────────
const startProxy = async () => {
  try {
    await Promise.all([
      waitForPort(3080, "127.0.0.1"),
      waitForPort(CPP_PORT, "127.0.0.1"),
    ]);
    console.log("[entry] Both upstream servers ready, starting proxy...");
  } catch (e) {
    console.error("[entry] Upstream servers not ready:", e.message);
    // Still start the proxy — it will return 502 until they are ready
  }

  const proxy = http.createServer((req, res) => {
    const options = {
      hostname: "127.0.0.1",
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
    const client = net.connect(CPP_PORT, "127.0.0.1", () => {
      // Forward the HTTP upgrade request to the C++ server
      const reqLine = `GET ${req.url} HTTP/1.1\r\n`;
      const headers = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      client.write(reqLine + headers + "\r\n\r\n");
      // Forward any data already received (should be empty for WebSocket)
      if (head && head.length > 0) client.write(head);
      // Bidirectional pipe
      client.pipe(socket).pipe(client);
    });
    client.on("error", () => { try { socket.destroy(); } catch {} });
    socket.on("error", () => { try { client.destroy(); } catch {} });
  });

  proxy.listen(RENDER_PORT, () => {
    console.log(`[entry] listening on :${RENDER_PORT} → Next.js :3080 / C++ :${CPP_PORT}`);
  });
};

startProxy();