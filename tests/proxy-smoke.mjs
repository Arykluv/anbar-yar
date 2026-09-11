const base = "http://127.0.0.1:4170";

async function probe(name, url) {
  const res = await fetch(base + "/fetch?url=" + encodeURIComponent(url));
  const text = await res.text();
  console.log(name, "status:", res.status, "cors:", res.headers.get("access-control-allow-origin"));
  console.log(name, "prefix:", (text || "").slice(0, 80).replace(/\n/g, " "));
  return res;
}

await probe("forbidden(google)", "https://www.google.com");
const real = await probe("torob(real)", "https://torob.com/mobile-tablet/");
console.log("LIVE TEST DONE");