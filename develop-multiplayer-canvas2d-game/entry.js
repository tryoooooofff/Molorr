/**
 * Production entry point.
 * Serves the Next.js frontend on Render's PORT and proxies
 * WebSocket game connections to the C++ server on :8081.
 */
const http = require("http");
const httpProxy = require("http");
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
// The Next.js server is at /app/nextjs/server.js (copied from .next/standalone)
const nextServer = spawn("node", [path.join(__dirname, "nextjs", "server.js")], {
  stdio: "inherit",
  env: { ...process.env, PORT: "3080" },
  cwd: path.join(__dirname, "nextjs"),
});

// ── 3. Wait for both servers to be ready, then start proxy ────────────
const startProxy = () => {
  const proxy = httpProxy.createServer((req, res) => {
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

  proxy.on("upgrade", (req, socket, head) => {
    const options = {
      hostname: "127.0.0.1",
      port: CPP_PORT,
      path: req.url,
      headers: req.headers,
    };
    const proxyReq = http.request(options);
    proxyReq.on("upgrade", (proxyRes, proxySocket) => {
      // Pipe the raw socket data
      proxySocket.pipe(socket).pipe(proxySocket);
    });
    proxyReq.on("error", () => {
      socket.destroy();
    });
    proxyReq.end();
  });

  proxy.listen(RENDER_PORT, () => {
    console.log(`[entry] listening on :${RENDER_PORT} → Next.js :3080 / C++ :${CPP_PORT}`);
  });
};

// Give both servers a moment to start, then launch the proxy
setTimeout(startProxy, 2000);