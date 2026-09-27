const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const root = __dirname;
const port = 8765;
const clients = new Set();

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const reloadScript = `<script>
(() => {
  const source = new EventSource("/__livereload");
  source.onmessage = () => location.reload();
})();
</script>`;

function sendReload() {
  for (const res of clients) res.write("data: reload\n\n");
}

let timer;
fs.watch(root, { recursive: true }, (_event, filename) => {
  if (!filename || filename === "dev-server.js") return;
  clearTimeout(timer);
  timer = setTimeout(sendReload, 80);
});

function appleString(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => '"' + line.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
    .join(" & return & ");
}

function openMailDraft(message, pdfPath) {
  const script = [
    'tell application "Mail"',
    "activate",
    "set theMessage to make new outgoing message with properties {visible:true, subject:" + appleString(message.subject) + ", content:" + appleString(message.body) + "}",
    "tell theMessage",
    "make new to recipient at end of to recipients with properties {address:" + appleString(message.to) + "}",
    "tell content",
    "make new attachment with properties {file name:POSIX file " + appleString(pdfPath) + "} at after the last paragraph",
    "end tell",
    "end tell",
    "end tell",
  ].join("\n");
  const scriptPath = path.join(os.tmpdir(), "invoice-mail-" + Date.now() + ".applescript");
  fs.writeFileSync(scriptPath, script);
  return new Promise((resolve, reject) => {
    execFile("osascript", [scriptPath], (err) => {
      fs.unlink(scriptPath, () => {});
      if (err) reject(err);
      else resolve();
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        reject(new Error("Email attachment is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "POST" && url.pathname === "/email-invoice") {
    readBody(req).then(async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid email request." }));
        return;
      }
      const to = String(message.to || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Enter a client email address." }));
        return;
      }
      const pdf = Buffer.from(String(message.pdf || ""), "base64");
      if (!pdf.length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "The invoice PDF is empty." }));
        return;
      }
      const filename = path.basename(String(message.filename || "Invoice.pdf")).replace(/[^\w.\-]+/g, "-");
      const pdfPath = path.join(os.tmpdir(), Date.now() + "-" + filename);
      fs.writeFileSync(pdfPath, pdf);
      try {
        await openMailDraft({
          to: to,
          subject: String(message.subject || "Invoice"),
          body: String(message.body || ""),
        }, pdfPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Mail could not open the invoice." }));
      }
    }).catch(() => {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Email request failed." }));
      }
    });
    return;
  }

  if (url.pathname === "/__livereload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.join(root, pathname);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file);
    res.setHeader("Content-Type", types[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    if (ext === ".html") {
      res.end(data.toString().replace("</body>", reloadScript + "</body>"));
      return;
    }
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("Live reload at http://127.0.0.1:" + port + "/");
});
