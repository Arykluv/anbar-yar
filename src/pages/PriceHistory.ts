import { h, clear } from "../app/dom";
import { db } from "../db/InventoryDB";
import type { Product } from "../models/types";
import { formatJalali, formatPrice, toFaDigits, formatNumber } from "../utils/format";
import { card } from "./page";

const FIELD_NAMES = {
  purchasePrice: "قیمت خرید",
  sellingPrice: "قیمت فروش",
  torobPrice: "قیمت ترب",
  listPrice: "قیمت در لیست",
  quantity: "موجودی",
} as const;

/** نمایش آخرین تغییرات قیمت/موجودی این محصول (از جدول priceHistory) */
export function PriceHistory(product: Product): HTMLElement {
  const body = h("div", { class: "history" });
  const load = async () => {
    try {
      const all = await db.priceHistory.where("productId").equals(product.id).toArray();
      all.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime() || (b.id ?? 0) - (a.id ?? 0));
      const entries = all.slice(0, 10);
      clear(body);
      if (entries.length === 0) {
        body.appendChild(h("p", { class: "muted", text: "تاریخچه‌ای ثبت نشده است." }));
        return;
      }
      const items = entries.map((entry) => {
        const label = FIELD_NAMES[entry.field] ?? entry.field;
        const oldV = entry.field === "quantity" ? toFaDigits(formatNumber(entry.oldValue ?? 0)) : formatPrice(entry.oldValue);
        const newV = entry.field === "quantity" ? toFaDigits(formatNumber(entry.newValue ?? 0)) : formatPrice(entry.newValue);
        return h(
          "li",
          { class: "history-item" },
          h("span", { class: "history-field", text: label }),
          h("span", { class: "history-change", text: `${oldV} ← ${newV}` }),
          h("time", { class: "history-time", text: formatJalali(entry.changedAt, true) }),
        );
      });
      body.appendChild(h("ul", { class: "history-list" }, ...items));
    } catch {
      body.appendChild(h("p", { class: "muted", text: "خواندن تاریخچه ممکن نشد." }));
    }
  };
  void load();
  return card({ class: "history-card", title: "تاریخچهٔ قیمت و موجودی" }, body);
}