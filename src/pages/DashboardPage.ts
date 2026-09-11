import { h, clear, input } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { onDataChanged } from "../app/events";
import { productRepository } from "../db/ProductRepository";
import { formatJalali, formatJalaliLong, formatPrice, toFaDigits, formatNumber } from "../utils/format";
import { computeAvailability, normalizeForComparison, parseNumericInput } from "../models/product";
import type { Product } from "../models/types";
import { card, pageHeader, emptyState } from "./page";
import { blobToObjectUrl } from "../models/product";
import { AppError } from "../services/errors";
import {
  fetchLiveRate,
  readCachedRate,
  usdToToman,
  tomanToUsd,
  type LiveExchangeRate,
} from "../services/currency/ExchangeRateService";

const EXCHANGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface DashboardStats {
  total: number;
  available: number;
  unavailable: number;
  totalValue: number | null;
  estimatedProfit: number | null;
  hasProfitData: boolean;
}

function inventoryValue(product: Product): number {
  if (product.sellingPrice !== null) return product.sellingPrice * product.quantity;
  if (product.purchasePrice !== null) return product.purchasePrice * product.quantity;
  if (product.torobPrice !== null) return product.torobPrice * product.quantity;
  return 0;
}

function calculateStats(products: Product[]): DashboardStats {
  const total = products.length;
  let available = 0;
  let totalValue = 0;
  let hasValue = false;
  let estimatedProfit = 0;
  let profitCount = 0;

  for (const product of products) {
    const avail = computeAvailability(product.quantity);
    if (avail === "available") available++;
    const value = inventoryValue(product);
    if (value > 0) hasValue = true;
    totalValue += value;
    if (product.sellingPrice !== null && product.purchasePrice !== null) {
      estimatedProfit += (product.sellingPrice - product.purchasePrice) * product.quantity;
      profitCount++;
    }
  }

  return {
    total,
    available,
    unavailable: total - available,
    totalValue: hasValue ? totalValue : null,
    estimatedProfit: profitCount > 0 ? estimatedProfit : null,
    hasProfitData: profitCount > 0,
  };
}

export function renderDashboard(container: HTMLElement, _route: Route): PageCleanup {
  const header = pageHeader("داشبورد", null, "نمای کلی انبار فروشگاه");
  const main = h("div", { class: "dashboard" });
  container.append(header, main);

  // ---------- قیمت لحظه‌ای دلار ----------
  const exchange = renderExchangeCard();

  async function load(): Promise<void> {
    clear(main);
    main.appendChild(exchange.card);
    const products = await productRepository.findAll();

    if (products.length === 0) {
      main.appendChild(
        emptyState(
          "📦",
          "انبار شما خالی است",
          "اولین محصول خود را اضافه کنید و مدیریت موجودی را شروع کنید.",
          h("a", { class: "btn btn-primary", attrs: { href: "#/add" }, text: "افزودن محصول" }),
        ),
      );
      return;
    }

    const stats = calculateStats(products);
    const hero = h(
      "section",
      { class: "hero", attrs: { "aria-label": "خوش آمدید" } },
      h("div", { class: "hero-glow" }),
      h("div", { class: "hero-content" },
        h("p", { class: "hero-eyebrow", text: "ابزار آلات شیرعلی" }),
        h("h2", { class: "hero-title", text: `${greeting()}، بابک شیرعلی` }),
        h("p", { class: "hero-sub", text: formatJalaliLong(new Date()) }),
        h("div", { class: "hero-actions" },
          h("a", { class: "btn btn-primary btn-lg", attrs: { href: "#/add" }, text: "＋ افزودن محصول" }),
          h("a", { class: "btn btn-glass", attrs: { href: "#/sale" }, text: "🧾 فاکتور فروش" }),
          h("a", { class: "btn btn-glass", attrs: { href: "#/products" }, text: "📦 مشاهده محصولات" }),
        ),
      ),
    );
    main.appendChild(hero);

    const statsCards = h(
      "section",
      { class: "stats-grid", attrs: { "aria-label": "آمار انبار" } },
      statCard("تعداد کل محصولات", `${toFaDigits(formatNumber(stats.total))}`, "کالا", "stat-total"),
      statCard("کالاهای موجود", `${toFaDigits(formatNumber(stats.available))}`, "کالا", "stat-available"),
      statCard("کالاهای ناموجود", `${toFaDigits(formatNumber(stats.unavailable))}`, "کالا", "stat-unavailable"),
      statCard(
        "ارزش کل موجودی",
        stats.totalValue !== null ? formatPrice(stats.totalValue) : "—",
        "بر اساس قیمت فروش",
        "stat-value",
      ),
    );
    main.appendChild(statsCards);

    if (stats.estimatedProfit !== null) {
      const profitClass = stats.estimatedProfit >= 0 ? "stat-profit" : "stat-loss";
      main.appendChild(
        h(
          "section",
          { class: "stats-grid stats-grid-extra" },
          statCard("سود تخمینی", formatPrice(stats.estimatedProfit), "قیمت فروش منهای خرید", profitClass),
        ),
      );
    }

    // ---------- جستجوی کالا ----------
    const searchInput = input("search", { placeholder: "جستجوی کالا…", autocomplete: "off" });
    searchInput.setAttribute("aria-label", "جستجوی کالا");
    searchInput.classList.add("dashboard-search-input");
    const resultsList = h("ul", { class: "recent-list" });
    const searchSection = h("section", { class: "dashboard-search" }, searchInput, resultsList);

    const recent = [...products].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 5);
    const recentSection = h("section", { class: "recent" },
      h("h2", { class: "recent-title", text: "آخرین بروزرسانی‌ها" }),
      h("ul", { class: "recent-list" }, ...recent.map((p) => recentRow(p))),
    );

    main.appendChild(searchSection);
    main.appendChild(recentSection);

    searchInput.addEventListener("input", renderSearch);
    function renderSearch(): void {
      const q = normalizeForComparison(searchInput.value.trim());
      clear(resultsList);
      if (!q) {
        recentSection.style.display = "";
        return;
      }
      recentSection.style.display = "none";
      const matches = products.filter((p) => normalizeForComparison(`${p.name} ${p.brand} ${p.category}`).includes(q));
      if (matches.length === 0) {
        resultsList.appendChild(h("p", { class: "muted dashboard-search-empty", text: "کالایی پیدا نشد." }));
        return;
      }
      matches.slice(0, 20).forEach((p) => resultsList.appendChild(recentRow(p)));
    }
  }

  function recentRow(product: Product): HTMLElement {
    const thumb = h("div", { class: "recent-thumb" });
    if (product.image) {
      const img = new Image();
      img.src = blobToObjectUrl(product.image);
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      thumb.appendChild(img);
    } else {
      thumb.appendChild(h("span", { text: "📦" }));
    }
    const isAvailable = computeAvailability(product.quantity) === "available";
    const li = h(
      "a",
      { class: "recent-item", attrs: { href: `#/product/${product.id}` } },
      thumb,
      h("div", { class: "recent-info" },
        h("span", { class: "recent-name", text: product.name }),
        h("span", { class: "recent-meta", text: `${formatPrice(product.sellingPrice ?? product.torobPrice)} · ${formatJalaliLong(product.updatedAt)}` }),
      ),
      h("span", { class: isAvailable ? "badge badge-available" : "badge badge-unavailable", text: isAvailable ? "موجود" : "ناموجود" }),
    );
    return li;
  }

  function statCard(label: string, value: string, hint: string, className: string): HTMLElement {
    return h(
      "div",
      { class: `stat-card ${className}` },
      h("span", { class: "stat-label", text: label }),
      h("span", { class: "stat-value-text", text: value }),
      h("span", { class: "stat-hint", text: hint }),
    );
  }

  const off = onDataChanged(load);
  void load();
  exchange.start();

  return () => {
    off();
    exchange.stop();
  };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "شب بخیر";
  if (h < 12) return "صبح بخیر";
  if (h < 17) return "ظهر بخیر";
  if (h < 21) return "عصر بخیر";
  return "شب بخیر";
}

/** کارت قیمت لحظه‌ای دلار (از صرافی نوبیتکس) همراه با مبدل تومان ↔ دلار */
function renderExchangeCard(): { card: HTMLElement; start: () => void; stop: () => void } {
  const cached = readCachedRate();

  const rateEl = h("span", { class: "exchange-rate-value", text: "…" });
  const metaEl = h("span", { class: "exchange-meta", text: "در حال دریافت نرخ…" });
  const statusEl = h("span", { class: "exchange-status" });
  const refreshBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, text: "به‌روزرسانی" });
  const tomanInput = input("text", { placeholder: "برای محاسبه بنویسید", inputmode: "numeric", autocomplete: "off" });
  const usdInput = input("text", { placeholder: "برای محاسبه بنویسید", inputmode: "decimal", autocomplete: "off" });

  let current: LiveExchangeRate | null = cached;
  let busy = false;
  let timer: number | undefined;

  function render(rate: LiveExchangeRate, opts: { offline?: boolean; error?: string } = {}): void {
    current = rate;
    rateEl.textContent = `${toFaDigits(formatNumber(rate.rate))} تومان`;
    const when = `به‌روزشده: ${formatJalali(rate.updatedAt, true)} · نوبیتکس (تتر)`;
    metaEl.textContent = opts.offline ? `آفلاین — ${when}` : when;
    statusEl.textContent = opts.error ?? "";
    statusEl.classList.toggle("exchange-error", Boolean(opts.error));
  }

  async function refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    refreshBtn.disabled = true;
    if (!current) statusEl.textContent = "در حال دریافت…";
    try {
      render(await fetchLiveRate());
    } catch (err) {
      const msg = err instanceof AppError ? err.userMessage : "دریافت قیمت دلار ممکن نشد.";
      if (current) {
        render(current, { offline: true, error: msg });
      } else {
        statusEl.textContent = msg;
        statusEl.classList.add("exchange-error");
        metaEl.textContent = "قیمت در حال حاضر در دسترس نیست؛ اتصال به اینترنت را بررسی کنید.";
      }
    } finally {
      busy = false;
      refreshBtn.disabled = false;
    }
  }

  tomanInput.addEventListener("input", () => {
    if (!current) return;
    const toman = parseNumericInput(tomanInput.value);
    usdInput.value = toman !== null ? String(Number(tomanToUsd(toman, current.rate).toFixed(2))) : "";
  });
  usdInput.addEventListener("input", () => {
    if (!current) return;
    const usd = parseNumericInput(usdInput.value);
    tomanInput.value = usd !== null ? String(usdToToman(usd, current.rate)) : "";
  });
  refreshBtn.addEventListener("click", () => void refresh());

  const body = h(
    "div",
    { class: "exchange-body" },
    h("div", { class: "exchange-info" }, h("span", { class: "exchange-rate-label", text: "۱ دلار / تتر =" }), rateEl),
    h("div", { class: "exchange-actions" }, metaEl, statusEl, refreshBtn),
    h(
      "div",
      { class: "exchange-converter" },
      h("div", { class: "field" }, h("label", { class: "field-label", text: "تومان" }), tomanInput),
      h("div", { class: "field" }, h("label", { class: "field-label", text: "دلار / تتر" }), usdInput),
    ),
    h("p", { class: "field-hint exchange-hint", text: "مبدل بر اساس آخرین نرخ نمایش‌داده‌شده محاسبه می‌کند؛ نرخ لحظه‌ای بازار تتر است نه نرخ سنا/دلار آزاد." }),
  );

  const cardEl = card({ class: "exchange-card", title: "قیمت لحظه‌ای دلار (تتر)" }, body);

  if (cached) render(cached, { offline: true });
  void refresh();

  return {
    card: cardEl,
    start: () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void refresh(), EXCHANGE_REFRESH_INTERVAL_MS);
    },
    stop: () => window.clearInterval(timer),
  };
}