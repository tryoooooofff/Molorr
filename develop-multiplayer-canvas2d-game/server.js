/**
 * Production entry point.
 * Serves the Next.js frontend on Render's PORT (:8080) and proxies
 * WebSocket game connections to the C++ server on :8081.
 */
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const RENDER_PORT = parseInt(process.env.PORT || "8080", 10);
const CPP_PORT = 8081;

// ── 1. Start the C++ game server on :8081 ─────────────────────────────
const cpp = spawn(path.join(__dirname, "petalia-server"), [], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(CPP_PORT) },
});
cpp.on("exit", (code) => {
  console.error(`[proxy] petalia-server exited with code ${code}`);
  process.exit(code);
});

// ── 2. Start the Next.js standalone server on a random port ────────────
const nextServer = spawn("node", [path.join(__dirname, "server.js")], {
  stdio: "inherit",
  env: { ...process.env, PORT: "0" }, // random port, we'll read from stdout
  cwd: __dirname,
});

// Parse the port from Next.js stdout
let nextPort = 3000;
nextServer.stdout?.on("data", (data) => {
  const m = data.toString().match(/http:\/\/localhost:(\d+)/);
  if (m) nextPort = parseInt(m[1], 10);
  process.stdout.write(data);
});

// ── 3. Reverse proxy: HTTP → Next.js, WebSocket → C++ ────────────────
const httpProxy = require("http").createServer((req, res) => {
  // Forward all HTTP requests to the Next.js server
  const options = {
    hostname: "127.0.0.1",
    port: nextPort,
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

httpProxy.on("upgrade", (req, socket, head) => {
  // Upgrade WebSocket connections to the C++ server
  const options = {
    hostname: "127.0.0.1",
    port: CPP_PORT,
    path: req.url,
    headers: req.headers,
  };
  const proxyReq = http.request(options);
  proxyReq.on("upgrade", (proxyRes, proxySocket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${proxyRes.headers["sec-websocket-accept"]}\r\n` +
      "\r\n"
    );
    proxySocket.pipe(socket).pipe(proxySocket);
  });
  proxyReq.on("error", () => {
    socket.destroy();
  });
  proxyReq.end();
});

httpProxy.listen(RENDER_PORT, () => {
  console.log(`[proxy] listening on :${RENDER_PORT} → Next.js :${nextPort} / C++ :${CPP_PORT}`);
});