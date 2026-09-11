"use strict";

// برنامهٔ دسکتاپ ویندوز: میزبان نسخهٔ وب آفلاین (dist) + پروکسی ترب + دریافت پشتیبان.
// بدون نیاز به Node.js روی سیستم کاربر؛ همه‌چیز داخل همین فایل اجرا می‌شود.

const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

app.setName("anbar-yar");

const APP_TITLE = "انبارنگار — ابزار آلات شیرعلی";
const TOROB_PORT = 4170;
const TOROB_HOST = "torob.com";
const RATE_API_HOST = "apiv2.nobitex.ir";
const PROXY_ALLOWED_HOSTS = [TOROB_HOST, RATE_API_HOST];
const TOROB_TIMEOUT_MS = 25000;
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_PROXY_BODY = 16 * 1024 * 1024;

function logToFile(text) {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "error.log"), `${new Date().toISOString()}\n${text}\n\n`, "utf8");
  } catch {}
}

process.on("uncaughtException", (err) => {
  logToFile(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logToFile(`unhandledRejection: ${reason && reason.stack ? reason.stack : String(reason)}`);
});

logToFile(
  `portable-env: DIR=${process.env.PORTABLE_EXECUTABLE_DIR ?? ""} FILE=${process.env.PORTABLE_EXECUTABLE_FILE ?? ""} execPath=${process.execPath}`,
);

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

function distRoot() {
  return path.join(app.getAppPath(), "dist");
}

function backupsRoot() {
  const portableDir =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    (process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null);
  if (portableDir && fs.existsSync(portableDir)) {
    return path.join(portableDir, "backup");
  }
  return path.join(app.getPath("userData"), "backups");
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
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

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ---------- سرور اصلی برنامه (توزیع فایل dist + دریافت پشتیبان) ----------

function createAppServer() {
  const root = distRoot();
  return http
    .createServer(async (req, res) => {
      let url;
      try {
        url = new URL(req.url || "/", "http://127.0.0.1");
      } catch {
        url = new URL("/", "http://127.0.0.1");
      }

      if (req.method === "POST" && url.pathname === "/backup") {
        let body;
        try {
          body = await readBody(req, MAX_BACKUP_BYTES);
        } catch {
          sendJson(res, 413, { ok: false, error: "بدنهٔ درخواست بیش از حد بزرگ است." });
          return;
        }
        if (!body || !body.trim()) {
          sendJson(res, 400, { ok: false, error: "بدنهٔ درخواست خالی است." });
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          sendJson(res, 400, { ok: false, error: "JSON نامعتبر است." });
          return;
        }
        if (!parsed || typeof parsed !== "object" || parsed.app !== "anbar") {
          sendJson(res, 400, { ok: false, error: "فایل پشتیبان معتبر نیست." });
          return;
        }
        try {
          fs.mkdirSync(backupsRoot(), { recursive: true });
          const name = `anbar-backup-${timestampName()}.json`;
          fs.writeFileSync(path.join(backupsRoot(), name), body, "utf8");
          console.log(`[backup] ذخیره شد: ${name}`);
          sendJson(res, 200, { ok: true, file: name });
        } catch (err) {
          console.error("[backup] خطا:", err.message);
          sendJson(res, 500, { ok: false, error: "نتوانستم فایل پشتیبان را بنویسم." });
        }
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("405");
        return;
      }

      let urlPath;
      try {
        urlPath = decodeURIComponent(url.pathname);
      } catch {
        urlPath = "/";
      }
      if (urlPath === "/") urlPath = "/index.html";

      let filePath = path.normalize(path.join(root, urlPath));
      if (!filePath.startsWith(root)) filePath = path.join(root, "index.html");

      fs.readFile(filePath, (err, data) => {
        if (err) {
          fs.readFile(path.join(root, "index.html"), (err2, fallback) => {
            if (err2) {
              res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
              res.end("404 — فایل یافت نشد");
              return;
            }
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": fallback.length,
              "Cache-Control": "no-cache",
            });
            res.end(fallback);
          });
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Length": data.length,
          "Cache-Control": "no-cache",
        });
        res.end(data);
      });
    })
    .listen(0, "127.0.0.1");
}

// ---------- پروکسی ترب (پورت ۴۱۷۰؛ در صورت اشغال بودن، نسخهٔ دیگر آن را می‌گیرد) ----------

function isAllowedTorobUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return PROXY_ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function startTorobProxy() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${TOROB_PORT}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "فقط درخواست GET پشتیبانی می‌شود." }));
      return;
    }
    if (url.pathname === "/ping") {
      res.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/fetch") {
      const target = url.searchParams.get("url");
      if (!target) {
        sendJson(res, 400, { error: "پارامتر url ارسال نشده است." });
        return;
      }
      if (!isAllowedTorobUrl(target)) {
        sendJson(res, 403, { error: "فقط آدرس‌های مجاز (torob.com و apiv2.nobitex.ir) پشتیبانی می‌شوند." });
        return;
      }
      let upstream;
      try {
        upstream = await fetch(target, {
          headers: {
            Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
            "Accept-Language": "fa,en;q=0.8",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(TOROB_TIMEOUT_MS),
        });
      } catch (err) {
        sendJson(res, 502, { error: "دریافت از آدرس مقصد ممکن نشد.", detail: String(err.message) });
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.byteLength > MAX_PROXY_BODY) {
        sendJson(res, 413, { error: "اندازهٔ پاسخ مقصد بیش از حد مجاز است." });
        return;
      }
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Content-Length": body.byteLength,
        "X-Torob-Proxy": "1",
        ...corsHeaders(),
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "مسیر نامعتبر. فقط /fetch و /ping پشتیبانی می‌شوند." }));
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.log("[torob-proxy] پورت ۴۱۷۰ در دست نسخهٔ دیگر برنامه است؛ از آن استفاده می‌شود.");
      return;
    }
    console.error("[torob-proxy] خطا:", err.message);
  });

  server.listen(TOROB_PORT, "127.0.0.1", () => {
    console.log(`[torob-proxy] آماده روی پورت ${TOROB_PORT}.`);
  });
}

// ---------- پنجرهٔ برنامه ----------

let mainWindow = null;

function createWindow(appUrl) {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 620,
    autoHideMenuBar: true,
    title: APP_TITLE,
    backgroundColor: "#f2f2f7",
    icon: path.join(app.getAppPath(), "public", "icons", "icon-512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    const child = new BrowserWindow({
      width: 980,
      height: 760,
      autoHideMenuBar: true,
      title: "فاکتور",
      parent: mainWindow,
    });
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (target && target !== "" && target !== "about:blank") {
      child.loadURL(target);
    } else {
      child.loadURL("about:blank");
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(appUrl);
}

// ---------- شروع ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startTorobProxy();
    const appServer = createAppServer();
    appServer.on("error", (err) => {
      console.error("خطا در راه‌اندازی سرور برنامه:", err.message);
      app.quit();
    });
    appServer.on("listening", () => {
      const { port } = appServer.address();
      const appUrl = `http://127.0.0.1:${port}/`;
      console.log(`سرور برنامه روی ${appUrl} بالا آمد.`);
      createWindow(appUrl);
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}