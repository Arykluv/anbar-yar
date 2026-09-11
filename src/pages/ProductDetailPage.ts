import { clear, h } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { navigate } from "../app/router";
import { toast } from "../app/toast";
import { confirmDialog } from "../app/modal";
import { onDataChanged, notifyDataChanged } from "../app/events";
import { ProductForm, type ProductFormResult } from "../components/ProductForm";
import { productRepository, getAvailability } from "../db/ProductRepository";
import { recordPriceHistory } from "../db/SettingsRepository";
import { blobToObjectUrl } from "../models/product";
import type { Product } from "../models/types";
import { formatJalali, formatJalaliLong, formatPrice, toFaDigits } from "../utils/format";
import { AppError } from "../services/errors";
import { card, emptyState, pageHeader, statusBadge } from "./page";
import { PriceHistory } from "./PriceHistory";

export function renderProductDetail(container: HTMLElement, route: Route): PageCleanup {
  const header = pageHeader(
    "جزئیات محصول",
    h("a", { class: "btn", attrs: { href: "#/products" }, text: "→ بازگشت به محصولات" }),
  );
  const main = h("div", { class: "product-detail" });
  container.append(header, main);

  async function load(): Promise<void> {
    if (route.id === null) {
      renderMissing();
      return;
    }
    const product = await productRepository.findById(route.id);
    if (!product) {
      renderMissing();
      return;
    }
    clear(main);
    renderSummary(product);
    renderEditForm(product);
  }

  function renderMissing(): void {
    clear(main);
    main.appendChild(
      emptyState(
        "🔍",
        "محصول یافت نشد",
        "این محصول ممکن است حذف شده باشد.",
        h("a", { class: "btn btn-primary", attrs: { href: "#/products" }, text: "بازگشت به محصولات" }),
      ),
    );
  }

  function renderSummary(product: Product): void {
    const imgBox = h("div", { class: "detail-image" });
    if (product.image) {
      const img = new Image();
      img.src = blobToObjectUrl(product.image);
      img.alt = product.name;
      img.decoding = "async";
      imgBox.appendChild(img);
    } else if (product.imageUrl) {
      const img = new Image();
      img.src = product.imageUrl;
      img.alt = product.name;
      img.decoding = "async";
      img.addEventListener("error", () => {
        imgBox.replaceChildren(h("span", { class: "card-image-fallback", text: "📦" }));
      });
      imgBox.appendChild(img);
    } else {
      imgBox.appendChild(h("span", { class: "card-image-fallback", text: "📦" }));
    }

    const available = getAvailability(product) === "available";
    const price = product.sellingPrice ?? product.purchasePrice ?? product.torobPrice;

    const info = h("div", { class: "detail-info" }, h("h2", { class: "detail-name", text: product.name }), h("div", { class: "detail-badges" }, statusBadge(available)));

    if (product.brand) info.append(h("p", { class: "detail-meta", text: `برند: ${product.brand}` }));
    if (product.category) info.append(h("p", { class: "detail-meta", text: `دسته‌بندی: ${product.category}` }));

    const priceGrid = h("div", { class: "detail-prices" },
      priceRow("قیمت", price !== null ? formatPrice(price) : "—"),
      priceRow("قیمت فروش", product.sellingPrice !== null ? formatPrice(product.sellingPrice) : "—"),
      priceRow("قیمت خرید", product.purchasePrice !== null ? formatPrice(product.purchasePrice) : "—"),
      priceRow("قیمت در لیست", product.listPrice !== null ? formatPrice(product.listPrice) : "—"),
      priceRow("قیمت ترب", product.torobPrice !== null ? formatPrice(product.torobPrice) : "—"),
    );
    info.appendChild(priceGrid);

    const qtyBox = h("div", { class: "detail-qty" },
      h("span", { class: "detail-meta", text: "موجودی" }),
      h("div", { class: "quantity-control" },
        h("button", { class: "btn qty-btn", attrs: { type: "button", "aria-label": "کاهش موجودی" }, text: "−", dataset: { delta: "-1" } }),
        h("span", { class: "qty-value", text: toFaDigits(String(product.quantity)) }),
        h("button", { class: "btn qty-btn", attrs: { type: "button", "aria-label": "افزایش موجودی" }, text: "+", dataset: { delta: "1" } }),
      ),
    );
    qtyBox.querySelectorAll<HTMLButtonElement>("[data-delta]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const delta = Number(btn.dataset.delta ?? "0");
        try {
          await productRepository.adjustQuantity(product.id, delta);
          toast(delta > 0 ? "موجودی افزایش یافت." : "موجودی کاهش یافت.", "success");
          notifyDataChanged();
        } catch (err) {
          toast(err instanceof AppError ? err.userMessage : "تغییر موجودی ناموفق بود.", "error");
        }
      });
    });
    info.appendChild(qtyBox);

    const meta = h("div", { class: "detail-meta-lines" },
      h("p", { class: "detail-meta", text: `ارزش کل: ${formatPrice((product.sellingPrice ?? product.purchasePrice ?? product.torobPrice ?? 0) * product.quantity)}` }),
      product.torobUrl ? h("p", { class: "detail-meta", text: "لینک ترب:" }, h("a", { class: "link", attrs: { href: product.torobUrl, target: "_blank", rel: "noopener noreferrer" }, text: product.torobUrl })) : null,
      h("p", { class: "detail-meta", text: `تاریخ ایجاد: ${formatJalaliLong(product.createdAt)}` }),
      h("p", { class: "detail-meta", text: `آخرین ویرایش: ${formatJalali(product.updatedAt, true)}` }),
    );
    info.appendChild(meta);

    if (product.description) info.append(h("p", { class: "detail-desc", text: product.description }));
    if (product.notes) info.append(h("p", { class: "detail-notes", text: `یادداشت: ${product.notes}` }));

    if (product.specifications.length > 0) {
      const specTable = h("table", { class: "spec-table" },
        h("caption", { class: "visually-hidden", text: "مشخصات محصول" }),
        ...product.specifications.map((spec) =>
          h("tr", {}, h("th", { text: spec.key }), h("td", { text: spec.value })),
        ),
      );
      info.appendChild(h("div", { class: "detail-specs", attrs: { "aria-label": "مشخصات" } }, h("h3", { class: "detail-subtitle", text: "مشخصات" }), specTable));
    }

    main.appendChild(
      card({ class: "detail-summary", title: "خلاصهٔ محصول" }, h("div", { class: "detail-layout" }, imgBox, info)),
    );
    main.appendChild(PriceHistory(product));
  }

  function priceRow(label: string, value: string): HTMLElement {
    return h("div", { class: "price-row" }, h("span", { class: "price-label", text: label }), h("span", { class: "price-value", text: value }));
  }

  function renderEditForm(product: Product): void {
    const categories = productRepository.categories().then((c) => c).catch(() => []);
    categories.then((cats) => {
      const form = new ProductForm({
        initial: product,
        categories: cats,
        submitLabel: "ذخیره تغییرات",
        torobInfo: product.torobUrl ? { url: product.torobUrl, id: product.torobId ?? "-" } : null,
      });

      form.onSubmit(async (result: ProductFormResult) => {
        form.showErrors(result.errors);
        if (result.errors.length > 0) return;
        const { input } = result;
        const dup = await productRepository.findDuplicates({ torobId: input.torobId, name: input.name }, product.id);
        const torobDup = dup.find((d) => d.type === "torobId");
        if (torobDup) {
          toast("این محصول قبلاً در انبار ثبت شده است.", "error");
          return;
        }
        const nameDup = dup.find((d) => d.type === "name");
        if (nameDup) {
          toast("محصولی با این نام قبلاً ثبت شده است.", "error");
          return;
        }
        try {
          await recordPriceHistory({
            productId: product.id,
            field: "purchasePrice",
            oldValue: product.purchasePrice,
            newValue: input.purchasePrice,
            changedAt: new Date(),
          });
          await recordPriceHistory({
            productId: product.id,
            field: "sellingPrice",
            oldValue: product.sellingPrice,
            newValue: input.sellingPrice,
            changedAt: new Date(),
          });
          await recordPriceHistory({
            productId: product.id,
            field: "listPrice",
            oldValue: product.listPrice,
            newValue: input.listPrice,
            changedAt: new Date(),
          });
          await recordPriceHistory({
            productId: product.id,
            field: "quantity",
            oldValue: product.quantity,
            newValue: input.quantity,
            changedAt: new Date(),
          });
          await productRepository.update(product.id, input);
          toast("تغییرات با موفقیت ذخیره شد.", "success");
          notifyDataChanged();
        } catch (err) {
          toast(err instanceof AppError ? err.userMessage : "ذخیرهٔ تغییرات با مشکل مواجه شد.", "error");
          console.error("[anbar] خطای بروزرسانی:", err);
        }
      });

      const deleteBtn = h("button", { class: "btn btn-danger btn-block", text: "حذف محصول" });
      deleteBtn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "حذف محصول",
          message: `آیا از حذف «${product.name}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`,
          confirmLabel: "بله، حذف شود",
          danger: true,
        });
        if (!ok) return;
        try {
          await productRepository.remove(product.id);
          toast("محصول حذف شد.", "success");
          navigate("#/products");
        } catch (err) {
          toast("حذف محصول با مشکل مواجه شد.", "error");
          console.error("[anbar] خطای حذف:", err);
        }
      });

      const editCard = card({ class: "detail-edit", title: "ویرایش محصول" }, form.element, deleteBtn);
      main.appendChild(editCard);
    });
  }

  const off = onDataChanged(load);
  void load();
  return off;
}