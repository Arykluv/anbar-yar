type Child = Node | string | number | null | undefined;

export interface ElementProps {
  class?: string | string[];
  text?: Child;
  title?: string;
  attrs?: Record<string, string>;
  dataset?: Record<string, string>;
  for?: string;
}

/** سازندهٔ امن المان بدون استفاده از innerHTML با دادهٔ خارجی */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.class) {
    node.className = Array.isArray(props.class) ? props.class.join(" ") : props.class;
  }
  if (props.text !== undefined && props.text !== null) {
    node.textContent = String(props.text);
  }
  if (props.title) node.title = props.title;
  if (props.for !== undefined) node.setAttribute("for", props.for);
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      node.setAttribute(key, value);
    }
  }
  if (props.dataset) {
    for (const [key, value] of Object.entries(props.dataset)) {
      node.dataset[key] = value;
    }
  }

  appendChildren(node, children);
  return node;
}

export function appendChildren(parent: Node, children: Child[]): void {
  const flat = children.flat(Infinity) as Child[];
  for (const child of flat) {
    if (child === null || child === undefined) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

/** ساخت input با دستهٔ class ثابت */
export function input(
  type: string,
  options: {
    value?: string;
    placeholder?: string;
    required?: boolean;
    inputmode?: string;
    autocomplete?: string;
    list?: string;
    step?: string;
    min?: string;
    disabled?: boolean;
  } = {},
): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  if (options.value !== undefined) node.value = options.value;
  if (options.placeholder) node.placeholder = options.placeholder;
  node.required = Boolean(options.required);
  if (options.inputmode) node.inputMode = options.inputmode;
  if (options.autocomplete) node.setAttribute("autocomplete", options.autocomplete);
  if (options.list) node.setAttribute("list", options.list);
  if (options.step) node.step = options.step;
  if (options.min) node.min = options.min;
  if (options.disabled) node.disabled = true;
  return node;
}

export function select(options: { name?: string }, items: { value: string; label: string; selected?: boolean }[]): HTMLSelectElement {
  const node = document.createElement("select");
  if (options.name) node.name = options.name;
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    if (item.selected) opt.selected = true;
    node.appendChild(opt);
  }
  return node;
}

/** خالی کردن و پاک‌سازی شنونده‌های یک المان */
export function clear(parent: HTMLElement): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}