import { h } from "../app/dom";
import { blobToObjectUrl } from "../models/product";
import { computeAvailability } from "../models/product";
import type { Product } from "../models/types";
import { formatNumber, toFaDigits } from "../utils/format";

/** کارت محصول در نمای شبکه/لیست */
export function ProductCard(product: Product): HTMLElement {
  const available = computeAvailability(product.quantity) === "available";
  const price = product.sellingPrice ?? product.purchasePrice ?? product.torobPrice;

  const imageBox = h("div", { class: "card-image" });
  if (product.image) {
    const img = new Image();
    img.src = blobToObjectUrl(product.image);
    img.alt = `تصویر ${product.name}`;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      imageBox.replaceChildren(h("span", { class: "card-image-fallback", text: "📦" }));
    });
    imageBox.appendChild(img);
  } else if (product.imageUrl) {
    const img = new Image();
    img.src = product.imageUrl;
    img.alt = `تصویر ${product.name}`;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      imageBox.replaceChildren(h("span", { class: "card-image-fallback", text: "📦" }));
    });
    imageBox.appendChild(img);
  } else {
    imageBox.appendChild(h("span", { class: "card-image-fallback", text: "📦" }));
  }

  const meta = h("div", { class: "card-meta" });
  if (product.brand) meta.appendChild(h("span", { class: "chip", text: product.brand }));
  if (product.category) meta.appendChild(h("span", { class: "chip chip-muted", text: product.category }));

  return h(
    "article",
    { class: "product-card" },
    imageBox,
    h("div", { class: "card-body" },
      h("h3", { class: "card-name", title: product.name, text: product.name }),
      meta,
      h("div", { class: "card-price", text: price !== null ? `${toFaDigits(formatNumber(price))} تومان` : "—" }),
      h("div", { class: "card-footer" },
        h("span", { class: "card-quantity", text: `موجودی: ${toFaDigits(String(product.quantity))}` }),
        h("span", { class: available ? "badge badge-available" : "badge badge-unavailable", text: available ? "موجود" : "ناموجود" }),
      ),
    ),
  );
}