import { clear, h, input } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { toast } from "../app/toast";
import { confirmDialog } from "../app/modal";
import { notifyDataChanged } from "../app/events";
import {
  salesRepository,
  getSavedSeller,
  saveSeller,
  DEFAULT_SELLER_NAME,
  DEFAULT_SELLER_POSTAL_CODE,
  DEFAULT_SELLER_PHONE,
  DEFAULT_SELLER_ADDRESS,
  PAYMENT_TYPE_LABELS,
  type InvoiceDetails,
  type SaleItem,
} from "../db/SalesRepository";
import { productRepository } from "../db/ProductRepository";
import {
  buildInvoiceHtmlWithLogo,
  downloadInvoiceHtml,
  printInvoice,
  invoiceFileName,
} from "../services/InvoiceService";
import { normalizeForComparison, parseNumericInput, parsePriceInput, parseQuantityInput } from "../models/product";
import type { Invoice, PaymentType, Product } from "../models/types";
import { formatJalali, formatNumber, formatPrice, toFaDigits } from "../utils/format";
import { AppError } from "../services/errors";
import { card, pageHeader } from "./page";

export function renderSale(container: HTMLElement, _route: Route): PageCleanup {
  const header = pageHeader(
    "فاکتور فروش",
    null,
    "سبد فروش بسازید؛ پس از تأیید، فاکتور HTML و PDF خروجی گرفته می‌شود و موجودی کم می‌شود.",
  );

  const main = h("div", { class: "sale-page" });
  container.append(header, main);

  let cart: SaleItem[] = [];
  let products: Product[] = [];

  // ---------- عناصر ورودی سبد ----------
  const nameField = h("label", { class: "field-label", text: "نام کالا" });
  const nameInput = input("text", { placeholder: "نام کالا (با پیشنهاد خودکار)", list: "sale-product-names", autocomplete: "off" });
  const nameBlock = h("div", { class: "field" }, nameField, nameInput);

  const qtyInput = input("number", { value: "1", min: "1", step: "1", inputmode: "numeric" });
  const qtyBlock = h("div", { class: "field" }, h("label", { class: "field-label", text: "تعداد" }), qtyInput);

  const priceInput = input("text", { placeholder: "تومان", inputmode: "numeric", autocomplete: "off" });
  const priceBlock = h("div", { class: "field" }, h("label", { class: "field-label", text: "قیمت واحد (تومان)" }), priceInput);

  const addBtn = h("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "＋ افزودن به فاکتور" });

  const datalist = h("datalist", { attrs: { id: "sale-product-names" } });
  nameBlock.appendChild(datalist);

  const cartArea = h("div", { class: "cart-area" });
  const totalsLine = h("p", { class: "sale-total-line" });
  const finalizeBtn = h("button", { class: "btn btn-primary btn-block", attrs: { type: "button" }, text: "ثبت فروش و صدور فاکتور" });
  const clearCartBtn = h("button", { class: "btn btn-ghost", attrs: { type: "button" }, text: "پاک‌کردن سبد" });

  const cartActions = h("div", { class: "sale-actions" }, clearCartBtn, finalizeBtn);

  // ---------- اطلاعات فاکتور ----------
  function partyFieldset(
    title: string,
    defaultName: string,
    options: { withAddress?: boolean; withNationalId?: boolean; defaultPostalCode?: string; defaultPhone?: string; defaultAddress?: string } = {},
  ) {
    const { withAddress = false, withNationalId = true } = options;
    const nameInput = input("text", { value: defaultName, placeholder: `نام ${title}`, autocomplete: "off" });
    const nationalIdInput = withNationalId ? input("text", { placeholder: "کد ملی", inputmode: "numeric", autocomplete: "off" }) : null;
    const postalCodeInput = input("text", { value: options.defaultPostalCode ?? "", placeholder: "کد پستی", inputmode: "numeric", autocomplete: "off" });
    const phoneInput = input("tel", { value: options.defaultPhone ?? "", placeholder: "تلفن", autocomplete: "off" });
    const addressInput = withAddress ? input("text", { value: options.defaultAddress ?? "", placeholder: "آدرس", autocomplete: "off" }) : null;

    const blocks: HTMLElement[] = [
      h("div", { class: "field" }, h("label", { class: "field-label", text: "نام" }), nameInput),
    ];
    if (nationalIdInput) {
      blocks.push(h("div", { class: "field" }, h("label", { class: "field-label", text: "کد ملی" }), nationalIdInput));
    }
    blocks.push(
      h("div", { class: "field" }, h("label", { class: "field-label", text: "کد پستی" }), postalCodeInput),
      h("div", { class: "field" }, h("label", { class: "field-label", text: "تلفن" }), phoneInput),
    );
    if (addressInput) {
      blocks.push(h("div", { class: "field sale-party-wide" }, h("label", { class: "field-label", text: "آدرس" }), addressInput));
    }

    const root = h("fieldset", { class: "sale-party" }, h("legend", { text: title }), ...blocks);

    return {
      root,
      values: () => ({
        name: nameInput.value.trim(),
        nationalId: nationalIdInput ? nationalIdInput.value.trim() : "",
        postalCode: postalCodeInput.value.trim(),
        phone: phoneInput.value.trim(),
        address: addressInput ? addressInput.value.trim() : "",
      }),
      setValues: (info: { name?: string; nationalId?: string; postalCode?: string; phone?: string; address?: string }) => {
        if (info.name !== undefined) nameInput.value = info.name;
        if (info.nationalId !== undefined && nationalIdInput) nationalIdInput.value = info.nationalId;
        if (info.postalCode !== undefined) postalCodeInput.value = info.postalCode;
        if (info.phone !== undefined) phoneInput.value = info.phone;
        if (info.address !== undefined && addressInput) addressInput.value = info.address;
      },
    };
  }

  const sellerParty = partyFieldset("فروشنده", DEFAULT_SELLER_NAME, {
    withAddress: true,
    withNationalId: false,
    defaultPostalCode: DEFAULT_SELLER_POSTAL_CODE,
    defaultPhone: DEFAULT_SELLER_PHONE,
    defaultAddress: DEFAULT_SELLER_ADDRESS,
  });
  const buyerParty = partyFieldset("خریدار", "");

  const paymentSelect = h("select", { attrs: { "aria-label": "نوع پرداخت" } },
    h("option", { attrs: { value: "cash" }, text: "نقدی" }),
    h("option", { attrs: { value: "credit" }, text: "غیر نقدی" }),
  );
  paymentSelect.classList.add("sale-pay-select");
  const paymentBlock = h("div", { class: "field sale-pay-field" }, h("label", { class: "field-label", text: "نوع پرداخت" }), paymentSelect);

  const discountInput = input("text", { placeholder: "مثلاً ۱۰", inputmode: "numeric", autocomplete: "off" });
  const discountBlock = h("div", { class: "field sale-pay-field" }, h("label", { class: "field-label", text: "تخفیف (٪)" }), discountInput);

  const infoCardRow = h("div", { class: "sale-info-grid" }, sellerParty.root, buyerParty.root, paymentBlock, discountBlock);

  const cartCard = card(
    { class: "sale-cart", title: "سبد فروش" },
    infoCardRow,
    h("div", { class: "sale-entry" }, nameBlock, qtyBlock, priceBlock, h("div", { class: "field sale-entry-btn" }, addBtn)),
    cartArea,
    totalsLine,
    cartActions,
  );

  // ---------- ثبت نهایی ----------
  function currentDiscountPercent(): number {
    const n = parseNumericInput(discountInput.value);
    if (n === null) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return Math.round(n);
  }

  function cartSubtotal(): number {
    return cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  }

  function addToCart(): void {
    const name = nameInput.value.trim();
    if (!name) {
      toast("نام کالا را وارد کنید.", "error");
      return;
    }
    const quantity = parseQuantityInput(qtyInput.value);
    if (quantity === null || quantity < 1) {
      toast("تعداد باید عدد صحیحِ بزرگ‌تر از صفر باشد.", "error");
      return;
    }
    const product = findProductByName(name);
    let price = parsePriceInput(priceInput.value);
    if (price === null && product) {
      price = defaultPrice(product);
      priceInput.value = price != null ? String(price) : "";
    }
    if (price === null) {
      toast("قیمت واحد را وارد کنید.", "error");
      return;
    }

    const existing = cart.find((c) => normalizeForComparison(c.name) === normalizeForComparison(name));
    if (existing && existing.productId === (product?.id ?? null)) {
      existing.quantity += quantity;
      existing.price = price;
    } else {
      cart.push({ name, quantity, price, productId: product?.id ?? null });
    }

    nameInput.value = "";
    qtyInput.value = "1";
    const nextDefault = product ? defaultPrice(product) : null;
    priceInput.value = nextDefault != null ? String(nextDefault) : "";
    renderCart();
  }

  async function finalizeSale(): Promise<void> {
    if (cart.length === 0) {
      toast("سبد فروش خالی است.", "error");
      return;
    }
    const paymentType: PaymentType = paymentSelect.value === "credit" ? "credit" : "cash";
    const seller = sellerParty.values();
    const buyer = buyerParty.values();
    const discountPercent = currentDiscountPercent();
    const details: InvoiceDetails = {
      sellerName: seller.name,
      sellerNationalId: seller.nationalId,
      sellerPostalCode: seller.postalCode,
      sellerPhone: seller.phone,
      sellerAddress: seller.address,
      buyerName: buyer.name,
      buyerNationalId: buyer.nationalId,
      buyerPostalCode: buyer.postalCode,
      buyerPhone: buyer.phone,
      paymentType,
      discountPercent,
    };
    const subtotal = cartSubtotal();
    const discountAmount = Math.round((subtotal * discountPercent) / 100);
    const total = subtotal - discountAmount;
    const summary = [
      details.buyerName ? `خریدار: ${details.buyerName}` : "خریدار: (نامشخص)",
      `${details.buyerPhone ? `تلفن: ${details.buyerPhone}` : ""}`.trim(),
      `نوع پرداخت: ${PAYMENT_TYPE_LABELS[paymentType]}`,
      ...cart.map((item) => `• ${item.name}: ${toFaDigits(String(item.quantity))} × ${formatNumber(item.price)} تومان`),
      discountPercent > 0 ? `تخفیف (${toFaDigits(String(discountPercent))}٪): −${formatNumber(discountAmount)} تومان` : "",
      `جمع کل: ${formatNumber(total)} تومان`,
    ].join("\n");

    const ok = await confirmDialog({
      title: "تأیید نهایی فروش",
      message: `${summary}\n\nبا این کار موجودی انبار کم می‌شود و فاکتور صادر می‌شود. مطمئن هستید؟`,
      confirmLabel: "بله، ثبت و صدور فاکتور",
    });
    if (!ok) return;

    try {
      const invoice = await salesRepository.createInvoice(cart, details);
      notifyDataChanged();
      void saveSeller(seller);

      const html = await buildInvoiceHtmlWithLogo(invoice);
      downloadInvoiceHtml(html, invoice.number);
      const opened = printInvoice(html);

      toast(`فاکتور شمارهٔ ${toFaDigits(String(invoice.number))} ثبت شد.`, "success", 5000);
      if (!opened) {
        toast("پنجرهٔ چاپ باز نشد. برای ساخت PDF، فایل دانلودشده را باز کرده و Ctrl+P بزنید.", "info", 7000);
      }

      cart = [];
      renderCart();
      void loadInvoices();
    } catch (err) {
      if (err instanceof AppError) {
        toast(err.userMessage, "error", 6000);
      } else {
        toast("ثبت فاکتور با مشکل مواجه شد.", "error");
        console.error("[anbar] خطای ثبت فاکتور:", err);
      }
    }
  }

  // ---------- رندر سبد ----------
  function renderCart(): void {
    clear(cartArea);

    const subtotal = cartSubtotal();
    const discountPercent = currentDiscountPercent();
    const discountAmount = Math.round((subtotal * discountPercent) / 100);
    const total = subtotal - discountAmount;

    if (cart.length === 0) {
      cartArea.appendChild(h("p", { class: "muted", text: "هیچ کالایی به سبد اضافه نشده است." }));
    } else {
      const table = h(
        "table",
        { class: "cart-table" },
        h("thead", {},
          h("tr", {},
            h("th", { text: "ردیف" }),
            h("th", { text: "نام کالا" }),
            h("th", { text: "تعداد" }),
            h("th", { text: "قیمت واحد (تومان)" }),
            h("th", { text: "جمع (تومان)" }),
            h("th", { text: "" }),
          ),
        ),
      );
      const tbody = h("tbody", {});
      cart.forEach((item, index) => {
        const removeBtn = h("button", { class: "btn btn-danger btn-sm", attrs: { type: "button", "aria-label": "حذف ردیف" }, text: "×" });
        removeBtn.addEventListener("click", () => {
          cart.splice(index, 1);
          renderCart();
        });
        const rowTotal = item.quantity * item.price;
        const row = h("tr", {},
          h("td", { class: "center", text: toFaDigits(String(index + 1)) }),
          h("td", { text: item.name }),
          h("td", { class: "center", text: toFaDigits(String(item.quantity)) }),
          h("td", { class: "left", text: toFaDigits(formatNumber(item.price)) }),
          h("td", { class: "left strong", text: toFaDigits(formatNumber(rowTotal)) }),
          h("td", { class: "center" }, removeBtn),
        );
        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      const tfoot = h("tfoot", {});
      const subtotalRow = h("tr", { class: "total-row" },
        h("td", { attrs: { colspan: "4" }, text: "جمع کل" }),
        h("td", { class: "left strong", text: `${toFaDigits(formatNumber(subtotal))} تومان` }),
        h("td", {}),
      );
      tfoot.appendChild(subtotalRow);
      if (discountPercent > 0) {
        tfoot.appendChild(h("tr", { class: "discount-row" },
          h("td", { attrs: { colspan: "4" }, text: `تخفیف (${toFaDigits(String(discountPercent))}٪)` }),
          h("td", { class: "left", text: `−${toFaDigits(formatNumber(discountAmount))} تومان` }),
          h("td", {}),
        ));
        tfoot.appendChild(h("tr", { class: "grand-total-row" },
          h("td", { attrs: { colspan: "4" }, text: "مبلغ قابل پرداخت" }),
          h("td", { class: "left strong", text: `${toFaDigits(formatNumber(total))} تومان` }),
          h("td", {}),
        ));
      }
      table.appendChild(tfoot);
      cartArea.appendChild(table);
    }

    totalsLine.textContent =
      cart.length > 0
        ? discountPercent > 0
          ? `جمع کل: ${toFaDigits(formatNumber(subtotal))} تومان — تخفیف ${toFaDigits(formatNumber(discountAmount))} تومان — قابل پرداخت: ${toFaDigits(formatNumber(cartSubtotal() - discountAmount))} تومان`
          : `جمع کل: ${toFaDigits(formatNumber(cartSubtotal()))} تومان`
        : "";
    finalizeBtn.disabled = cart.length === 0;
  }

  discountInput.addEventListener("input", () => renderCart());

  // ---------- فاکتورهای قبلی ----------
  const invoicesCard = card({ class: "sale-history", title: "فاکتورهای قبلی" });
  const invoicesBody = h("div", { class: "invoice-list" });
  invoicesCard.appendChild(invoicesBody);
  main.append(cartCard, invoicesCard);

  async function loadInvoices(): Promise<void> {
    const invoices = await salesRepository.listInvoices();
    clear(invoicesBody);
    if (invoices.length === 0) {
      invoicesBody.appendChild(h("p", { class: "muted", text: "هنوز فاکتوری صادر نشده است." }));
      return;
    }
    for (const invoice of invoices) {
      invoicesBody.appendChild(invoiceRow(invoice));
    }
  }

  function invoiceRow(invoice: Invoice): HTMLElement {
    const count = invoice.items.reduce((s, it) => s + it.quantity, 0);
    const printBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, text: "چاپ / PDF" });
    const downloadBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, text: "HTML" });
    const deleteBtn = h("button", { class: "btn btn-danger btn-sm", attrs: { type: "button" }, text: "حذف" });
    printBtn.addEventListener("click", () => {
      void (async () => {
        const html = await buildInvoiceHtmlWithLogo(invoice);
        if (!printInvoice(html)) {
          downloadInvoiceHtml(html, invoice.number);
          toast(`پنجرهٔ چاپ باز نشد؛ فایل ${invoiceFileName(invoice.number)} دانلود شد.`, "info", 6000);
        }
      })();
    });
    downloadBtn.addEventListener("click", () => {
      void (async () => {
        const html = await buildInvoiceHtmlWithLogo(invoice);
        downloadInvoiceHtml(html, invoice.number);
      })();
    });
    deleteBtn.addEventListener("click", () => {
      void deleteInvoiceRow(invoice);
    });

    return h(
      "div",
      { class: "invoice-row" },
      h("div", { class: "invoice-row-main" },
        h("span", { class: "invoice-row-title", text: `فاکتور شمارهٔ ${toFaDigits(String(invoice.number))}` }),
        h("span", { class: "invoice-row-meta", text: `${formatJalali(invoice.createdAt, true)} · ${toFaDigits(String(count))} کالا` }),
        h("span", { class: "invoice-row-meta", text: `خریدار: ${invoice.buyerName || "—"} · ${PAYMENT_TYPE_LABELS[invoice.paymentType ?? "cash"]}` }),
      ),
      h("div", { class: "invoice-row-total", text: formatPrice(invoice.total) }),
      h("div", { class: "invoice-row-actions" }, downloadBtn, printBtn, deleteBtn),
    );
  }

  async function deleteInvoiceRow(invoice: Invoice): Promise<void> {
    if (invoice.id === undefined) return;
    try {
      await salesRepository.deleteInvoice(invoice.id);
      toast(`فاکتور شمارهٔ ${toFaDigits(String(invoice.number))} حذف شد.`, "info", 4000);
      void loadInvoices();
    } catch (err) {
      toast("حذف فاکتور با مشکل مواجه شد.", "error");
      console.error("[anbar] خطای حذف فاکتور:", err);
    }
  }

  // ---------- بستن ----------
  addBtn.addEventListener("click", addToCart);
  nameInput.addEventListener("change", () => {
    const product = findProductByName(nameInput.value.trim());
    const price = product ? defaultPrice(product) : null;
    priceInput.value = price != null ? String(price) : "";
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addToCart();
    }
  });
  qtyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addToCart();
    }
  });
  priceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addToCart();
    }
  });
  finalizeBtn.addEventListener("click", finalizeSale);
  clearCartBtn.addEventListener("click", () => {
    cart = [];
    renderCart();
  });

  void (async () => {
    try {
      products = await productRepository.findAll();
      applyDatalist(products);
    } catch {
      products = [];
    }
    const savedSeller = await getSavedSeller();
    if (savedSeller) sellerParty.setValues(savedSeller);
    renderCart();
    void loadInvoices();
  })();

  return () => {};
}

function defaultPrice(product: Product): number | null {
  return product.listPrice ?? product.sellingPrice ?? product.purchasePrice ?? product.torobPrice ?? null;
}

function findProductByName(name: string): Product | undefined {
  return productListCache.current.find((p) => normalizeForComparison(p.name) === normalizeForComparison(name));
}

// اطلاعات محصولات جاری برای جستجوی نام (در renderSale گوشی می‌شود)
const productListCache: { current: Product[] } = { current: [] };

function applyDatalist(products: Product[]): void {
  productListCache.current = products;
  const datalist = document.getElementById("sale-product-names");
  if (!datalist) return;
  clear(datalist);
  for (const p of products) {
    datalist.appendChild(h("option", { attrs: { value: p.name } }));
  }
}