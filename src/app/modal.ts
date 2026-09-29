import { h } from "./dom";

/** دیالوگ سفارشی با محتوای دلخواه؛ با Esc یا کلیک روی پس‌زمینه بسته می‌شود */
export interface ModalOptions {
  title: string;
  content: HTMLElement;
  actions?: HTMLElement;
}

export function openModal(options: ModalOptions): { close: () => void } {
  const overlay = h("div", { class: "modal-overlay", attrs: { role: "dialog" } });
  const dialog = h("div", { class: "modal modal-form", attrs: { role: "document" } });

  const title = h("h2", { class: "modal-title", text: options.title });
  const body = h("div", { class: "modal-content" });
  body.appendChild(options.content);

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  function close(): void {
    overlay.remove();
    window.removeEventListener("keydown", onKey);
    if (previouslyFocused) previouslyFocused.focus();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", onKey);

  dialog.append(title, body);
  if (options.actions) dialog.appendChild(options.actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  return { close };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * دیالوگ تأیید؛ در صورت تأیید true و در غیر این صورت false برمی‌گرداند.
 * با Esc یا کلیک روی پس‌زمینه نیز لغو می‌شود.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "modal-overlay", attrs: { role: "dialog" } });
    const dialog = h("div", { class: "modal", attrs: { role: "document" } });

    const title = h("h2", { class: "modal-title", text: options.title });
    const message = h("p", { class: "modal-message", text: options.message });

    const cancelBtn = h("button", { class: "btn", text: options.cancelLabel ?? "لغو" });
    const confirmBtn = h("button", {
      class: options.danger ? "btn btn-danger" : "btn btn-primary",
      text: options.confirmLabel,
    });

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function close(value: boolean): void {
      overlay.remove();
      window.removeEventListener("keydown", onKey);
      if (previouslyFocused) previouslyFocused.focus();
      resolve(value);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    }

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(false);
    });
    window.addEventListener("keydown", onKey);

    const actions = h("div", { class: "modal-actions" }, cancelBtn, confirmBtn);
    dialog.append(title, message, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    confirmBtn.focus();
  });
}