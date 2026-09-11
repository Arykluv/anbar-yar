// پروکسی محلیِ ترب — یک سرور کوچک Node.js بدون وابستگی
// با اجرای run.bat این سرور روی پورت 4170 بالا می‌آید و محدودیت CORS مرورگر را دور می‌زند.
//
// اجرای دستی:  node scripts/torob-proxy.mjs
import http from "node:http";

const PORT = Number(process.env.PORT || 4170);
const ALLOWED_HOSTS = ["torob.com", "apiv2.nobitex.ir"];
const TIMEOUT_MS = 25000;
const MAX_BODY = 16 * 1024 * 1024; // 16 مگابایت

function json(status, body) {
  const payload = JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isAllowedUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

async function handleFetch(query, res) {
  const target = query.get("url");
  if (!target) {
    return json(400, { error: "پارامتر url الزامی است." });
  }
  if (!isAllowedUrl(target)) {
    return json(403, { error: "فقط آدرس‌های مجاز (torob.com و apiv2.nobitex.ir) پشتیبانی می‌شوند." });
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
        "Accept-Language": "fa,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return json(502, { error: "دریافت از آدرس مقصد ممکن نشد.", detail: String(err.message) });
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BODY) {
    return json(413, { error: "پاسخ دریافتی بیش از حد بزرگ است." });
  }

  res.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") || "application/octet-stream",
    "X-Torob-Proxy": "1",
    "Content-Length": body.byteLength,
    ...corsHeaders(),
  });
  res.end(Buffer.from(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "فقط GET پشتیبانی می‌شود." }));
    return;
  }

  if (url.pathname === "/ping") {
    res.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/fetch") {
    const result = await handleFetch(url.searchParams, res);
    if (result) {
      res.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      res.end(await result.arrayBuffer());
    }
    return;
  }

  res.writeHead(404, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "مسیر یافت نشد. فقط /fetch و /ping پشتیبانی می‌شوند." }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[torob-proxy] پروکسی محلی روی پورت ${PORT} فعال است.`);
});

process.on("SIGINT", () => {
  console.log("[torob-proxy] خاموش شد.");
  server.close(() => process.exit(0));
});