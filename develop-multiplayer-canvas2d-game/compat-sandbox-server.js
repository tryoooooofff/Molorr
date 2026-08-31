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
  // Some sandbox/iframe previews disable storage. The game uses localStorage
  // in several places, so provide an in-memory fallback when it is blocked.
  (function () {
    try {
      var probe = "__petalia_sandbox_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return; // real localStorage is usable
    } catch (e) {
      var mem = {};
      var safe = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[String(k)] = String(v); },
        removeItem: function (k) { delete mem[String(k)]; },
        clear: function () { mem = {}; },
        key: function (i) { return Object.keys(mem)[i] || null; },
        get length () { return Object.keys(mem).length; }
      };
      try {
        Object.defineProperty(window, "localStorage", { configurable: true, get: function () { return safe; } });
      } catch (e2) {
        window.localStorage = safe;
      }
    }
  })();

  // Tiny diagnostics overlay. It is injected before the game bundle and only
  // shows when something goes wrong, so it never disturbs normal gameplay.
  (function () {
    var notes = [];
    function ensure() {
      if (!document.body) return false;
      if (document.getElementById("__petalia_diag__")) return true;
      var el = document.createElement("div");
      el.id = "__petalia_diag__";
      el.setAttribute("data-testid", "petalia-diag");
      el.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(680px,90vw);" +
        "max-height:40vh;overflow:auto;background:rgba(30,40,52,.92);color:#fff;" +
        "font:12px/1.45 monospace;padding:8px 10px;border-radius:6px;white-space:pre-wrap;";
      document.body.appendChild(el);
      render();
      return true;
    }
    function push(text) {
      notes.push(String(text));
      if (notes.length > 12) notes.shift();
      render();
    }
    function render() {
      var el = document.getElementById("__petalia_diag__");
      if (el) el.textContent = notes.join("\\n");
    }
    window.addEventListener("error", function (e) {
      push("[error] " + (e && e.message ? e.message : "unknown") +
        (e && e.filename ? " @ " + e.filename + ":" + e.lineno : ""));
      ensure();
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      push("[promise] " + (r && r.message ? r.message : String(r)));
      ensure();
    });
    var origOnError = window.onerror;
    window.onerror = function (msg, src, line, col, err) {
      push("[onerror] " + msg + " @ " + src + ":" + line + ":" + col);
      ensure();
      if (origOnError) return origOnError.apply(window, arguments);
    };
    document.addEventListener("DOMContentLoaded", function () {
      ensure(); // create the overlay only so error listeners have a target
    });
    window.__petaliaDiag = { push: push, clear: function(){ notes.length=0; render(); } };
  })();

  var NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return;
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
    var target = rewrite(url);
    var ws = protocols === undefined
      ? new NativeWebSocket(target)
      : new NativeWebSocket(target, protocols);
    try {
      if (window.console && console.info) console.info("[sandbox ws] " + String(url) + " -> " + String(target));
      ws.addEventListener("open", function () {
        if (window.console && console.info) console.info("[sandbox ws] open " + String(target));
      });
      ws.addEventListener("error", function () {
        if (window.console && console.error) console.error("[sandbox ws] error " + String(target));
        window.__petaliaDiag && window.__petaliaDiag.push("[ws] error " + String(target));
      });
      ws.addEventListener("close", function (e) {
        if (window.console && console.info) console.info("[sandbox ws] close code=" + (e && e.code) + " " + String(target));
      });
    } catch (e) { /* ignore */ }
    return ws;
  }
  SandboxWebSocket.prototype = NativeWebSocket.prototype;
  SandboxWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  SandboxWebSocket.OPEN = NativeWebSocket.OPEN;
  SandboxWebSocket.CLOSING = NativeWebSocket.CLOSING;
  SandboxWebSocket.CLOSED = NativeWebSocket.CLOSED;
  window.WebSocket = SandboxWebSocket;
})();
`;

function replaceHost(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === "host") continue;
    if (key === "accept-encoding") continue; // keep upstream uncompressed so we can patch HTML
    out[k] = v;
  }
  out.host = `${NEXT_HOST}:${NEXT_PORT}`;
  out["accept-encoding"] = "identity";
  return out;
}

function injectCompat(body) {
  const needle = "</head>";
  const idx = body.indexOf(needle);
  if (idx === -1) return body;
  const snippet =
    `<script src="/compat/sandbox.js"></script>`;
  return body.slice(0, idx) + snippet + body.slice(idx);
}

const server = http.createServer((req, res) => {
  // Serve the injected browser script from the wrapper itself.
  if (req.url === "/compat/sandbox.js") {
    res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
    res.end(COMPAT_JS);
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

// WebSocket upgrade → raw TCP proxy to the local game server.
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "/";
  console.log(`[compat] ws upgrade ${req.headers.origin || "-"} -> ${url}`);
  if (url.split("?")[0] !== "/game") {
    console.log("[compat] ws upgrade rejected: path is not /game");
    socket.destroy();
    return;
  }

  const client = net.connect(GAME_PORT, GAME_HOST, () => {
    console.log(`[compat] ws upgrade connected to game server :${GAME_PORT}`);
    const lines = [`GET /game HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      lines.push(`${key}: ${value}`);
    }
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
