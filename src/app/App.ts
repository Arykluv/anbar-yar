import { clear, h } from "./dom";
import { currentRoute, type Route } from "./router";
import { toast } from "./toast";
import { checkDatabase } from "../db/InventoryDB";
import { autoBackupIfDue } from "../services/BackupService";

const NAV_ITEMS: { hash: string; icon: string; label: string }[] = [
  { hash: "#/", icon: "📊", label: "داشبورد" },
  { hash: "#/products", icon: "📦", label: "محصولات" },
  { hash: "#/add", icon: "➕", label: "افزودن محصول" },
  { hash: "#/sale", icon: "🧾", label: "فاکتور فروش" },
  { hash: "#/settings", icon: "⚙️", label: "تنظیمات" },
];

export interface PageCleanup {
  (): void;
}

type PageRenderer = (container: HTMLElement, route: Route) => PageCleanup | void;

/** بارگذاری تنبل صفحه‌ها: هر صفحه تنها در زمان بازدید واکشی و پردازش می‌شود */
const pageLoaders: Record<string, () => Promise<PageRenderer>> = {
  dashboard: async () => (await import("../pages/DashboardPage")).renderDashboard,
  products: async () => (await import("../pages/ProductsPage")).renderProducts,
  add: async () => (await import("../pages/AddProductPage")).renderAddProduct,
  product: async () => (await import("../pages/ProductDetailPage")).renderProductDetail,
  sale: async () => (await import("../pages/SalePage")).renderSale,
  settings: async () => (await import("../pages/SettingsPage")).renderSettings,
};

export function initApp(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("ریشهٔ برنامه پیدا نشد.");

  const page = h("main", { class: "main", attrs: { id: "page-container" } });
  const shell = h("div", { class: "app-shell" }, buildSidebar(), page);
  clear(root);
  root.appendChild(shell);

  let currentCleanup: PageCleanup | null = null;
  let renderSeq = 0;

  async function renderPage(): Promise<void> {
    const seq = ++renderSeq;
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    const route = currentRoute();
    const container = document.getElementById("page-container");
    if (!container) return;
    clear(container);

    const loader = pageLoaders[route.name];
    if (!loader) {
      renderNotFound(container);
      updateActiveNav(route.name);
      return;
    }

    container.appendChild(
      h("div", { class: "loading-state" }, h("span", { class: "spinner" }), h("span", { text: "در حال بارگذاری..." })),
    );

    try {
      const renderer = await loader();
      if (seq !== renderSeq) return;
      clear(container);
      currentCleanup = renderer(container, route) ?? null;
    } catch {
      if (seq !== renderSeq) return;
      clear(container);
      renderNotFound(container);
    }
    updateActiveNav(route.name);
  }

  window.addEventListener("hashchange", renderPage);
  window.addEventListener("storage", renderPage);
  void renderPage();
  wireOfflineStatus();
  void checkDatabase().then((status) => {
    if (!status.ok) toast(status.message, "error", 8000);
  });
  void autoBackupIfDue();
}

function buildSidebar(): HTMLElement {
  return h(
    "aside",
    { class: "sidebar" },
    h("div", { class: "brand" }, h("span", { class: "brand-icon", text: "🛠️" }), h("span", { class: "brand-name", text: "انبارنگار" })),
    h(
      "nav",
      { class: "nav", attrs: { "aria-label": "منوی اصلی" } },
      ...NAV_ITEMS.map((item) =>
        h("a", { class: "nav-link", attrs: { href: item.hash }, text: `${item.icon} ${item.label}` }),
      ),
    ),
    h(
      "div",
      { class: "sidebar-foot" },
      h("span", { class: "offline-badge", attrs: { id: "offline-badge" }, text: "آفلاین" }),
    ),
  );
}

function updateActiveNav(routeName: string): void {
  const links = document.querySelectorAll<HTMLAnchorElement>(".nav-link");
  links.forEach((link) => {
    const target = link.getAttribute("href") ?? "";
    const active = routeIsActive(routeName, target);
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function routeIsActive(routeName: string, href: string): boolean {
  if (href === "#/") return routeName === "dashboard";
  if (href === "#/products") return routeName === "products" || routeName === "product";
  return href === `#/${routeName}`;
}

function renderNotFound(container: HTMLElement): void {
  container.appendChild(
    h(
      "div",
      { class: "empty-state" },
      h("p", { class: "empty-icon", text: "⚠️" }),
      h("h1", { text: "صفحه پیدا نشد" }),
      h("p", { text: "آدرس درخواستی معتبر نیست." }),
      h("a", { class: "btn btn-primary", attrs: { href: "#/" }, text: "بازگشت به داشبورد" }),
    ),
  );
}

let offlineWired = false;
function wireOfflineStatus(): void {
  if (offlineWired) return;
  offlineWired = true;
  const badge = document.getElementById("offline-badge");

  const update = () => {
    const offline = !navigator.onLine;
    badge?.classList.toggle("hidden", !offline);
    if (offline) toast("اتصال به اینترنت قطع شد. برنامه به‌صورت آفلاین کار می‌کند.", "info", 5000);
  };
  update();
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}