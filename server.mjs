// Field-test app: redirects, cookies and a WebSocket echo, no dependencies.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const VERSION = process.env.APP_VERSION ?? "v2-preview";
const port = Number(process.env.PORT ?? 3000);

const page = (req) => `<!doctype html><meta charset="utf-8"><title>vfy-test-gateway ${VERSION}</title>
<h1 id="version">${VERSION}</h1>
<p>Host: <code id="host">${req.headers.host}</code></p>
<p>Cookie: <code id="cookie">${req.headers.cookie ?? "(none)"}</code></p>
<p><a href="/login">/login</a> (sets a cookie, 302 → /me) · <a href="/old">/old</a> (301 → /new) · <a href="/abs">/abs</a> (302 to an absolute URL)</p>
<p>WebSocket: <code id="ws">connecting…</code></p>
<script>
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
const out = document.getElementById("ws");
ws.onopen = () => ws.send("ping " + Date.now());
ws.onmessage = (e) => { out.textContent = "ok: " + e.data; ws.close(); };
ws.onerror = () => { out.textContent = "error"; };
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://app");
  switch (url.pathname) {
    case "/":
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(page(req));
    case "/login":
      res.writeHead(302, { "Set-Cookie": "sid=field-test; Path=/; HttpOnly; SameSite=Lax", Location: "/me" });
      return res.end();
    case "/me":
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(`cookie: ${req.headers.cookie ?? "(none)"}\n`);
    case "/old":
      res.writeHead(301, { Location: "/new" });
      return res.end();
    case "/new":
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("new\n");
    case "/abs":
      res.writeHead(302, { Location: `http://${req.headers.host}/me` });
      return res.end();
    case "/health":
      res.writeHead(200);
      return res.end("ok");
    default:
      res.writeHead(404);
      return res.end("not found\n");
  }
});

// The smallest WebSocket echo: text frames up to 125 bytes.
server.on("upgrade", (req, socket) => {
  if (new URL(req.url, "http://app").pathname !== "/ws") return socket.destroy();
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("data", (buf) => {
    const op = buf[0] & 0x0f;
    if (op === 8) return socket.end();
    const len = buf[1] & 0x7f;
    const mask = buf.subarray(2, 6);
    const data = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4]));
    const reply = Buffer.from(`echo ${data.toString()} via ${VERSION}`);
    socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
  });
});

server.listen(port, () => console.log(`vfy-test-gateway ${VERSION} on :${port}`));
