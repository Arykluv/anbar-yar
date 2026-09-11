import { clear, h, input } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { navigate } from "../app/router";
import { toast } from "../app/toast";
import { ProductForm, type ProductFormResult } from "../components/ProductForm";
import { productRepository } from "../db/ProductRepository";
import { getProviderForUrl, type ExternalProduct, type ProductProvider } from "../services/ProductProvider";
import { downloadImageToBlob } from "../services/ImageStore";
import { AppError } from "../services/errors";
import { pageHeader } from "./page";
import { isValidTorobUrl } from "../services/torob/url";

export function renderAddProduct(container: HTMLElement, _route: Route): PageCleanup {
  const header = pageHeader("افزودن محصول", null, "ثبت کالای جدید در انبار");

  const torobSection = buildTorobInputSection();
  const resultArea = h("div", { class: "add-result" });
  container.append(header, torobSection.element, resultArea);

  function setBusy(busy: boolean): void {
    torobSection.fetchButton.disabled = busy;
    torobSection.input.disabled = busy;
    torobSection.fetchButton.textContent = busy ? "در حال دریافت..." : "دریافت اطلاعات محصول";
  }

  async function fetchFromTorob(): Promise<void> {
    const url = torobSection.input.value.trim();
    if (!url) {
      toast("لطفاً لینک ترب را وارد کنید.", "error");
      return;
    }
    if (!isValidTorobUrl(url)) {
      toast("لینک واردشده معتبر نیست.", "error");
      return;
    }
    const provider = getProviderForUrl(url);
    if (!provider) {
      toast("این لینک توسط هیچ فراهم‌کننده‌ای پشتیبانی نمی‌شود.", "error");
      return;
    }

    setBusy(true);
    clear(resultArea);
    resultArea.appendChild(buildLoading("در حال دریافت اطلاعات از ترب..."));
    try {
      const external = await provider.getProductFromUrl(url);
      const image = await tryDownloadImage(external.imageUrl);
      await showPreviewForm(provider, external, image);
    } catch (err) {
      clear(resultArea);
      resultArea.appendChild(buildErrorBox(err));
    } finally {
      setBusy(false);
    }
  }

  torobSection.fetchButton.addEventListener("click", fetchFromTorob);
  torobSection.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fetchFromTorob();
    }
  });
  torobSection.manualButton.addEventListener("click", () => {
    clear(resultArea);
    void showPreviewForm(null, null, null);
  });

  async function showPreviewForm(provider: ProductProvider | null, external: ExternalProduct | null, image: Blob | null): Promise<void> {
    clear(resultArea);
    const now = new Date().toISOString();

    const previewNote =
      provider && external
        ? h(
            "div",
            { class: "callout callout-info" },
            h("p", { text: "اطلاعات زیر از ترب استخراج شده است. قبل از ذخیره، آن را بررسی و در صورت نیاز ویرایش کنید." }),
          )
        : null;

    let categories: string[] = [];
    try {
      categories = await productRepository.categories();
    } catch {
      categories = [];
    }
    const form = new ProductForm({
      submitLabel: "ذخیره محصول",
      onCancel: () => navigate("#/add"),
      categories,
      imageFile: image ?? undefined,
      torobInfo: external ? { url: external.sourceUrl, id: external.sourceId ?? "" } : null,
      initial: external
        ? {
            id: 0,
            name: external.name,
            category: external.category ?? "",
            brand: external.brand ?? "",
            quantity: 0,
            purchasePrice: null,
            sellingPrice: null,
            listPrice: null,
            torobPrice: external.price,
            torobUrl: external.sourceUrl,
            torobId: external.sourceId,
            image: null,
            imageUrl: provider && !image ? external.imageUrl : null,
            description: external.description ?? "",
            specifications: external.specifications,
            notes: "",
            createdAt: new Date(now),
            updatedAt: new Date(now),
          }
        : null,
    });

    form.onSubmit(async (result: ProductFormResult) => {
      form.showErrors(result.errors);
      if (result.errors.length > 0) return;
      const input = { ...result.input };

      if (external) {
        input.torobUrl = external.sourceUrl;
        input.torobId = external.sourceId;
      }

      try {
        const duplicates = await productRepository.findDuplicates(input);
        const torobDup = duplicates.find((d) => d.type === "torobId");
        if (torobDup) {
          toast("این محصول قبلاً در انبار ثبت شده است.", "error");
          return;
        }
        const nameDup = duplicates.find((d) => d.type === "name");
        if (nameDup) {
          toast("محصولی با این نام قبلاً در انبار ثبت شده است.", "error");
          return;
        }

        const product = await productRepository.create(input);
        toast(`محصول «${product.name}» با موفقیت ذخیره شد.`, "success");
        navigate(`#/product/${product.id}`);
      } catch (err) {
        if (err instanceof AppError) {
          toast(err.userMessage, "error", 6000);
        } else {
          toast("ذخیرهٔ محصول با مشکل مواجه شد.", "error");
          console.error("[anbar] خطای ذخیره محصول:", err);
        }
      }
    });

    if (previewNote) resultArea.append(previewNote);
    resultArea.append(form.element);
  }

  return () => {};
}

async function tryDownloadImage(url: string | null): Promise<Blob | null> {
  if (!url) return null;
  const result = await downloadImageToBlob(url);
  if (result.blob) return result.blob;
  if (result.error) {
    console.info("[anbar] تصویر دانلود نشد:", result.error);
  }
  return null;
}

function buildLoading(text: string): HTMLElement {
  return h("div", { class: "loading-state", attrs: { role: "status" } }, h("span", { class: "spinner" }), h("p", { text }));
}

function buildErrorBox(err: unknown): HTMLElement {
  const message = err instanceof AppError ? err.userMessage : "دریافت اطلاعات محصول با مشکل مواجه شد.";

  const genericMessage =
    "اطلاعات جعلی ثبت نمی‌شود؛ این پیام به شما کمک می‌کند مشکل را رفع کنید. اگر از طریق پروکسی اتصال برقرار کنید، این قابلیت به‌صورت خودکار کار خواهد کرد.";

  return h(
    "div",
    { class: "callout callout-error", attrs: { role: "alert" } },
    h("h3", { text: "⚠️ دریافت اطلاعات با مشکل مواجه شد" }),
    h("p", { text: message }),
    h("p", { class: "callout-small", text: genericMessage }),
  );
}

function buildTorobInputSection(): {
  element: HTMLElement;
  input: HTMLInputElement;
  fetchButton: HTMLButtonElement;
  manualButton: HTMLButtonElement;
} {
  const urlInput = input("url", {
    placeholder: "https://torob.com/p/xxxxxxxx/",
    autocomplete: "off",
  });
  urlInput.dir = "ltr";
  urlInput.classList.add("torob-input");

  const fetchBtn = h("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "دریافت اطلاعات محصول" });
  const manualBtn = h("button", { class: "btn btn-ghost", attrs: { type: "button" }, text: "ثبت دستی محصول" });

  const element = h(
    "section",
    { class: "torob-section card" },
    h("h2", { class: "card-title", text: "افزودن از لینک ترب" }),
    h("p", { class: "section-desc", text: "لینک محصول ترب را وارد کنید تا اطلاعات آن به‌صورت خودکار دریافت شود." }),
    h("div", { class: "torob-row" }, urlInput, fetchBtn),
    h("div", { class: "torob-alt" }, h("span", { class: "torob-divider", text: "یا" }), manualBtn),
  );

  return { element, input: urlInput, fetchButton: fetchBtn, manualButton: manualBtn };
}