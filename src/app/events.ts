/** رویداد عمومی تغییر دادهٔ محلی؛ صفحات بعد از هر نوشتن، این رویداد را می‌گیرند و بازنمایی می‌کنند */
export const DATA_CHANGED_EVENT = "anbar:data-changed";

export function notifyDataChanged(): void {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}

export function onDataChanged(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
}