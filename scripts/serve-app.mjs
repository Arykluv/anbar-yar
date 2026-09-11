import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "dist");
const BACKUPS_DIR = path.resolve(__dirname, "..", "backups");
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "localhost";
const APP_URL = `http://${HOST}:${PORT}/`;
const MAX_BACKUP_BYTES = 256 * 1024 * 1024; // 256 مگابایت

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function send(res, status, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 — فایل یافت نشد");
      return;
    }
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BACKUP_BYTES) {
        reject(new Error("body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function handleBackup(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(413, { ok: false, error: "بدنهٔ درخواست بیش از حد بزرگ است." });
  }
  if (!body || !body.trim()) {
    return json(400, { ok: false, error: "بدنهٔ درخواست خالی است." });
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { ok: false, error: "JSON نامعتبر است." });
  }
  if (!parsed || typeof parsed !== "object" || parsed.app !== "anbar") {
    return json(400, { ok: false, error: "فایل پشتیبان معتبر نیست." });
  }
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  } catch (err) {
    console.error("[backup] ساخت پوشهٔ backups ناموفق:", err.message);
    return json(500, { ok: false, error: "نتوانستم پوشهٔ backups را بسازم." });
  }
  const name = `anbar-backup-${timestampName()}.json`;
  try {
    fs.writeFileSync(path.join(BACKUPS_DIR, name), body, "utf8");
  } catch (err) {
    console.error("[backup] نوشتن فایل ناموفق:", err.message);
    return json(500, { ok: false, error: "نتوانستم فایل پشتیبان را بنویسم." });
  }
  console.log(`[backup] پشتیبان ذخیره شد: ${name}`);
  return json(200, { ok: true, file: name });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || "/", APP_URL);
  } catch {
    url = new URL("/", APP_URL);
  }

  if (req.method === "POST" && url.pathname === "/backup") {
    try {
      const result = await handleBackup(req, res);
      res.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch (err) {
      console.error("[backup] خطای غیرمنتظره:", err);
      const result = json(500, { ok: false, error: "خطای غیرمنتظرهٔ سرور." });
      res.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      res.end(Buffer.from(await result.arrayBuffer()));
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("405");
    return;
  }
  let urlPath = url.pathname;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    /* مسیر دارای دنبالهٔ ناقص ٪ است؛ بدون decode استفاده می‌شود */
  }
  if (urlPath === "/") urlPath = "/index.html";

  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) filePath = path.join(ROOT, "index.html");

  fs.stat(filePath, (err, st) => {
    if (!err && st.isFile()) {
      send(res, 200, filePath);
    } else {
      send(res, 200, path.join(ROOT, "index.html"));
    }
  });
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.log("برنامه همین حالا هم در حال اجراست؛ مرورگر باز می‌شود.");
    openBrowser();
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  console.error("خطا در راه‌اندازی سرور:", err.message);
  process.exit(1);
});

function openBrowser() {
  try {
    spawn("cmd", ["/c", "start", "", APP_URL], { stdio: "ignore" }).unref();
  } catch {
    /* نادیده گرفته می‌شود */
  }
}

server.listen(PORT, HOST, () => {
  if (!fs.existsSync(path.join(ROOT, "index.html"))) {
    console.error("فایل index.html در پوشهٔ dist پیدا نشد؛ run.bat را دوباره اجرا کنید.");
    process.exit(1);
  }
  console.log("سرور استاتیک بالا آمد.");
  console.log(`برنامه روی آدرس ${APP_URL} در حال اجراست.`);
  openBrowser();
});