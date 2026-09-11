import { h } from "./dom";

export type ToastKind = "success" | "error" | "info";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = h("div", { class: "toasts", attrs: { "aria-live": "polite", "aria-atomic": "false" } });
  document.body.appendChild(container);
  return container;
}

/** نمایش پیام لحظه‌ای (Toast) */
export function toast(message: string, kind: ToastKind = "info", duration = 3800): void {
  const item = h(
    "div",
    { class: `toast toast-${kind}`, attrs: { role: "status" } },
    h("span", { class: "toast-message", text: message }),
  );
  const close = h("button", { class: "toast-close", attrs: { type: "button", "aria-label": "بستن" }, text: "×" });
  close.addEventListener("click", () => remove());
  item.appendChild(close);
  ensureContainer().appendChild(item);

  function remove(): void {
    item.classList.add("toast-out");
    window.setTimeout(() => item.remove(), 250);
  }
  window.setTimeout(remove, duration);
}