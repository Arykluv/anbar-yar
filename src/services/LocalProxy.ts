/** آدرس پروکسی محلی که توسط run.bat (scripts/torob-proxy.mjs) بالا می‌آید */
export const LOCAL_PROXY_ORIGIN = "http://127.0.0.1:4170";

/** ساخت آدرس پروکسی برای بازیابی یک URL */
export function proxyFetchUrl(url: string): string {
  return `${LOCAL_PROXY_ORIGIN}/fetch?url=${encodeURIComponent(url)}`;
}