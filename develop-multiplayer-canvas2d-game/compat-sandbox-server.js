/**
 * Arena/Sandbox compatibility wrapper — does NOT touch the game source.
 *
 * It runs in front of:
 *   - Next.js dev server (assumed on 127.0.0.1:3100) for the HTTP frontend
 *   - the local TypeScript game server (assumed on 127.0.0.1:8080) for WebSocket
 *
 * The vanilla client hard-codes `wss://molorr-server-*.onrender.com` when it
 * connects. That host is not reachable from this sandbox, so this wrapper injects
 * one tiny browser-side compatibility script into the HTML page. The script only
 * rewrites those hard-coded onrender.com WebSocket URLs to `wss://<preview-host>/game`.
 * Everything else (including Next.js HMR) is untouched.
 *
 * Bind: 0.0.0.0:<PORT> — this is the live preview entry point.
 */
"use strict";

const http = require("http");
const net = require("net");

const PORT = Number(process.env.PORT || 3000);
const NEXT_PORT = Number(process.env.NEXT_PORT || 3100);
const GAME_PORT = Number(process.env.GAME_PORT || 8080);
const NEXT_HOST = process.env.NEXT_HOST || "127.0.0.1";
const GAME_HOST = process.env.GAME_HOST || "127.0.0.1";

/**
 * Browser-side compatibility shim. It replaces window.WebSocket with a subclass
 * that rewrites only the game's hard-coded Render hosts to this preview host.
 */
const COMPAT_JS = `
(function () {
  try {
    // ---- Diagnostics: installed first, so any later failure is visible. ----
    var notes = [];
    var bodyReady = false;
    var overlay = null;
    function ensureOverlay() {
      try {
        if (!document.body) return false;
        bodyReady = true;
        if (overlay) return true;
        overlay = document.createElement("div");
        overlay.id = "__petalia_diag__";
        overlay.setAttribute("data-testid", "petalia-diag");
        overlay.style.cssText =
          "position:fixed;left:8px;bottom:8px;z-index:2147483647;" +
          "max-width:min(680px,90vw);max-height:40vh;overflow:auto;" +
          "background:rgba(20,28,38,.94);color:#d8e6f2;" +
          "font:11px/1.45 monospace;padding:8px 10px;border-radius:6px;" +
          "white-space:pre-wrap;pointer-events:none;";
        document.body.appendChild(overlay);
        render();
        return true;
      } catch (e) { return false; }
    }
    function render() {
      if (overlay) overlay.textContent = notes.join("\\n");
    }
    function push(text) {
      try {
        notes.push(String(text));
        if (notes.length > 14) notes.shift();
        render();
        ensureOverlay();
      } catch (e) {}
    }
    function clear() { try { notes.length = 0; render(); } catch (e) {} }
    window.__petaliaDiag = { push: push, clear: clear, notes: notes };

    window.addEventListener("error", function (e) {
      push("[error] " + (e && e.message ? e.message : "unknown") +
        (e && e.filename ? " @ " + e.filename + ":" + e.lineno : ""));
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      push("[promise] " + (r && r.message ? r.message : String(r)));
    });
    var origOnError = window.onerror;
    window.onerror = function (msg, src, line, col, err) {
      push("[onerror] " + msg + " @ " + src + ":" + line + ":" + col);
      if (origOnError) return origOnError.apply(window, arguments);
    };
    document.addEventListener("DOMContentLoaded", function () {
      try { ensureOverlay(); } catch (e) {}
    });
    setTimeout(function () { try { ensureOverlay(); } catch (e) {} }, 50);

    // ---- localStorage fallback. Never throw in a sandboxed iframe. ----
    try {
      var probe = "__petalia_sandbox_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
    } catch (e) {
      try {
        var mem = {};
        var safe = {
          getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
          setItem: function (k, v) { try { mem[String(k)] = String(v); } catch (e2) {} },
          removeItem: function (k) { try { delete mem[String(k)]; } catch (e2) {} },
          clear: function () { try { mem = {}; } catch (e2) {} },
          key: function (i) { return Object.keys(mem)[i] || null; },
          get length () { try { return Object.keys(mem).length; } catch (e2) { return 0; } }
        };
        try {
          Object.defineProperty(window, "localStorage", { configurable: true, get: function () { return safe; } });
        } catch (e2) {
          try { window.localStorage = safe; } catch (e3) {}
        }
      } catch (e4) {}
    }

    // ---- WebSocket shim: rewrite only the suspended Render hosts. ----
    var NativeWebSocket = window.WebSocket;
    if (NativeWebSocket && window.URL) {
      var GAME_HOSTS = /molorr-server-(?:t34o|sg|hk)\.onrender\.com/i;
      function rewrite(url) {
        try {
          var u = new URL(String(url), window.location.href);
          if (GAME_HOSTS.test(u.hostname)) {
            var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
            return proto + "//" + window.location.host + "/game";
          }
        } catch (e) {}
        return url;
      }
      function SandboxWebSocket(url, protocols) {
        try {
          var target = rewrite(url);
          var isGameSocket = String(target).indexOf("/game") !== -1;
          var ws = protocols === undefined
            ? new NativeWebSocket(target)
            : new NativeWebSocket(target, protocols);
          if (isGameSocket) {
            push("[game] connecting " + String(target));
            try {
              ws.addEventListener("open", function () {
                push("[game] connected");
                if (window.console && console.info) console.info("[petalia sandbox] game socket open", target);
              });
              ws.addEventListener("error", function () {
                push("[game] error " + String(target));
                if (window.console && console.error) console.error("[petalia sandbox] game socket error", target);
              });
              ws.addEventListener("close", function (e) {
                push("[game] close " + (e && e.code) + " " + String(target));
              });
            } catch (e) {}
          }
          return ws;
        } catch (e) {
          try { return new NativeWebSocket(url, protocols); }
          catch (e2) { throw e; }
        }
      }
      SandboxWebSocket.prototype = NativeWebSocket.prototype;
      SandboxWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
      SandboxWebSocket.OPEN = NativeWebSocket.OPEN;
      SandboxWebSocket.CLOSING = NativeWebSocket.CLOSING;
      SandboxWebSocket.CLOSED = NativeWebSocket.CLOSED;
      window.WebSocket = SandboxWebSocket;
    }
    push("[compat] active");
  } catch (e) {
    try {
      if (window.__petaliaDiag && window.__petaliaDiag.push)
        window.__petaliaDiag.push("[compat] " + (e && e.message));
    } catch (e2) {}
  }
})();
`;

function replaceHost(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === "host") continue;
    // The browser sends the preview host in Origin. Next.js treats that as a
    // cross-origin dev host and can block dev resources, so present the
    // internal Next origin to it.
    if (key === "origin" || key === "accept-encoding") continue;
    out[k] = v;
  }
  out.host = `${NEXT_HOST}:${NEXT_PORT}`;
  out.origin = `http://${NEXT_HOST}:${NEXT_PORT}`;
  out["accept-encoding"] = "identity";
  return out;
}

function injectCompat(body) {
  // Inject as the very first thing inside <head> so the WebSocket/localStorage
  // shim exists before any app bundle script can observe the globals. Placing
  // it near </head> is too late: Next.js marks its entries `async`, so an app
  // chunk may already have captured the native WebSocket by then.
  const head = "<head>";
  const idx = body.indexOf(head);
  if (idx !== -1) {
    const snippet =
      `<script src="/compat/sandbox.js"></script>`;
    return body.slice(0, idx + head.length) + snippet + body.slice(idx + head.length);
  }
  const closeIdx = body.indexOf("</head>");
  if (closeIdx === -1) return body;
  const snippet =
    `<script src="/compat/sandbox.js"></script>`;
  return body.slice(0, closeIdx) + snippet + body.slice(closeIdx);
}

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    const done = (ok) => { try { s.destroy(); } catch (e) {} resolve(ok); };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    s.on("timeout", () => done(false));
    s.setTimeout(1500);
  });
}

const server = http.createServer((req, res) => {
  // Serve the injected browser script from the wrapper itself.
  if (req.url === "/compat/sandbox.js") {
    res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
    res.end(COMPAT_JS);
    return;
  }

  // Sandbox health endpoint (the C++ server has no HTTP /health route).
  if (req.url === "/health" || req.url === "/debug") {
    checkTcp(GAME_HOST, GAME_PORT).then((game) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({
        ok: game,
        frontend: true,
        game: game,
        next: NEXT_HOST + ":" + NEXT_PORT,
        gameServer: GAME_HOST + ":" + GAME_PORT,
        gameIsCpp: true,
      }));
    });
    return;
  }

  const options = {
    hostname: NEXT_HOST,
    port: NEXT_PORT,
    path: req.url,
    method: req.method,
    headers: replaceHost(req.headers),
  };

  const proxyReq = http.request(options, (upstreamRes) => {
    const type = String(upstreamRes.headers["content-type"] || "");
    const patchHtml = type.indexOf("text/html") !== -1;
    if (!patchHtml) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }

    // Buffer HTML so we can inject the compat <script> into <head>.
    const chunks = [];
    let len = 0;
    upstreamRes.on("data", (c) => {
      chunks.push(c);
      len += c.length;
      if (len > 8 * 1024 * 1024) {
        upstreamRes.destroy();
        res.writeHead(502);
        res.end(`too large`);
      }
    });
    upstreamRes.on("end", () => {
      const body = injectCompat(Buffer.concat(chunks).toString("utf8"));
      const headers = { ...upstreamRes.headers };
      delete headers["content-length"];
      delete headers["content-encoding"];
      delete headers["transfer-encoding"];
      res.writeHead(upstreamRes.statusCode || 200, { ...headers, "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
    upstreamRes.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Bad Gateway");
    });
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });
  req.pipe(proxyReq);
});

// WebSocket upgrade → raw TCP proxy.
//  - /game                → local TypeScript game server
//  - everything else      → internal Next.js dev server (HMR, etc.)
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "/";
  const path = url.split("?")[0];
  const isGame = path === "/game";

  const targetHost = isGame ? GAME_HOST : NEXT_HOST;
  const targetPort = isGame ? GAME_PORT : NEXT_PORT;
  const targetPath = isGame ? "/game" : url;
  if (!isGame) {
    console.log(`[compat] ws upgrade ${req.headers.origin || "-"} -> next ${targetPath}`);
  }

  const client = net.connect(targetPort, targetHost, () => {
    const lines = [`GET ${targetPath} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      // Next.js blocks cross-origin dev WebSocket upgrades (HMR) unless the
      // Origin matches its own dev host. The browser uses the preview host,
      // so present the internal Next origin when forwarding these upgrades.
      if (!isGame && key.toLowerCase() === "origin") continue;
      lines.push(`${key}: ${value}`);
    }
    lines.push(`host: ${targetHost}:${targetPort}`);
    if (!isGame) lines.push(`origin: http://${targetHost}:${targetPort}`);
    client.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) client.write(head);

    socket.pipe(client);
    client.pipe(socket);
  });

  const cleanup = () => {
    socket.destroy();
    client.destroy();
  };
  socket.on("error", cleanup);
  client.on("error", cleanup);
  socket.on("close", cleanup);
  client.on("close", cleanup);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[compat] sandbox wrapper listening on http://0.0.0.0:${PORT} ` +
    `→ next ${NEXT_HOST}:${NEXT_PORT}, game ${GAME_HOST}:${GAME_PORT}`,
  );
});
