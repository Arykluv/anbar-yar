import { h, type ElementProps } from "../app/dom";

/** هدر استاندارد صفحه */
export function pageHeader(title: string, actions?: HTMLElement | null, subtitle?: string): HTMLElement {
  return h(
    "header",
    { class: "page-header" },
    h("div", { class: "page-heading" }, h("h1", { text: title }), subtitle ? h("p", { class: "page-subtitle", text: subtitle }) : null),
    actions ?? null,
  );
}

/** وضعیت خالی */
export function emptyState(icon: string, title: string, message: string, action?: HTMLElement | null): HTMLElement {
  return h(
    "div",
    { class: "empty-state" },
    h("p", { class: "empty-icon", text: icon }),
    h("h2", { text: title }),
    h("p", { text: message }),
    action ?? null,
  );
}

/** card ساده با عنوان دلخواه */
export function card(props: ElementProps & { title?: string }, ...children: unknown[]): HTMLElement {
  const body = h("div", { class: "card" }, ...(children as (Node | string | null)[]));
  if (props.class) body.classList.add(...String(props.class).split(" "));
  if (props.title) {
    const heading = h("h2", { class: "card-title", text: props.title });
    body.prepend(heading);
  }
  return body;
}

/** نشان وضعیت */
export function statusBadge(available: boolean): HTMLElement {
  return h(
    "span",
    { class: available ? "badge badge-available" : "badge badge-unavailable" },
    available ? "موجود" : "ناموجود",
  );
}