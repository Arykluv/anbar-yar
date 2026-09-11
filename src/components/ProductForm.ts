import { h, input, clear } from "../app/dom";
import { blobToObjectUrl, parsePriceInput, parseQuantityInput, validateProductInput } from "../models/product";
import { compressImage } from "../models/image";
import type { Product, ProductInput, Specification } from "../models/types";

interface SpecRow {
  container: HTMLElement;
  keyInput: HTMLInputElement;
  valueInput: HTMLInputElement;
}

export interface ProductFormResult {
  input: ProductInput;
  errors: string[];
}

export interface ProductFormOptions {
  /** محصول موجود برای ویرایش */
  initial?: Product | null;
  /** دسته‌بندی‌های پیشنهادی */
  categories?: string[];
  /** نمایش اطلاعات لینک ترب */
  torobInfo?: { url: string; id: string } | null;
  /** برچسب دکمهٔ اصلی */
  submitLabel: string;
  /** نمایش دکمهٔ بازگشت */
  onCancel?: (() => void) | null;
  /** انتخاب خودکار تصویر در حالت افزودن */
  imageFile?: Blob | null;
}

/** فرم جامع محصول؛ برای افزودن و ویرایش استفاده می‌شود */
export class ProductForm {
  readonly element: HTMLElement;

  private readonly nameInput: HTMLInputElement;
  private readonly categoryInput: HTMLInputElement;
  private readonly brandInput: HTMLInputElement;
  private readonly quantityInput: HTMLInputElement;
  private readonly purchaseInput: HTMLInputElement;
  private readonly sellingInput: HTMLInputElement;
  private readonly listPriceInput: HTMLInputElement;
  private readonly torobPriceInput: HTMLInputElement;
  private readonly descriptionInput: HTMLTextAreaElement;
  private readonly notesInput: HTMLTextAreaElement;
  private readonly specArea: HTMLElement;
  private readonly imageInput: HTMLInputElement;
  private readonly imagePreview: HTMLElement;
  private selectedImage: Blob | null = null;
  private remoteImageUrl: string | null = null;

  private specRows: SpecRow[] = [];
  private readonly categories: string[];

  constructor(options: ProductFormOptions) {
    this.categories = options.categories ?? [];

    const initial = options.initial ?? null;
    // هنگام ویرایش، تصویر بلابِ موجود محصول پیش‌فرض حفظ می‌شود تا بدون دست زدن به آن پاک نشود
    this.selectedImage = options.imageFile ?? initial?.image ?? null;
    this.remoteImageUrl = options.imageFile ? null : (initial?.imageUrl ?? null);

    const nameField = field("نام محصول", {
      control: input("text", { value: initial?.name ?? "", required: true, placeholder: "مثلاً گوشی سامسونگ A54", autocomplete: "off" }),
      required: true,
    });
    this.nameInput = nameField.control as HTMLInputElement;

    const categoryField = field("دسته‌بندی", {
      control: input("text", { value: initial?.category ?? "", placeholder: "مثلاً موبایل", list: "category-options", autocomplete: "off" }),
    });
    this.categoryInput = categoryField.control as HTMLInputElement;

    const brandField = field("برند", {
      control: input("text", { value: initial?.brand ?? "", placeholder: "مثلاً سامسونگ", autocomplete: "off" }),
    });
    this.brandInput = brandField.control as HTMLInputElement;

    const quantityField = field("موجودی", { control: h("div", {}) });
    this.quantityInput = buildQuantityControl(quantityField.control, initial?.quantity ?? 0);

    const purchaseField = field("قیمت خرید (تومان)", {
      control: input("text", { value: initial?.purchasePrice?.toString() ?? "", inputmode: "numeric", autocomplete: "off", placeholder: "اختیاری" }),
    });
    this.purchaseInput = purchaseField.control as HTMLInputElement;

    const sellingField = field("قیمت فروش (تومان)", {
      control: input("text", { value: initial?.sellingPrice?.toString() ?? "", inputmode: "numeric", autocomplete: "off", placeholder: "اختیاری" }),
    });
    this.sellingInput = sellingField.control as HTMLInputElement;

    const listPriceField = field("قیمت در لیست (تومان)", {
      control: input("text", { value: initial?.listPrice?.toString() ?? "", inputmode: "numeric", autocomplete: "off", placeholder: "اختیاری" }),
    });
    this.listPriceInput = listPriceField.control as HTMLInputElement;

    const torobField = field("قیمت ترب (رقم دقیق به تومان)", {
      control: input("text", { value: initial?.torobPrice != null ? String(initial.torobPrice) : "", inputmode: "numeric", autocomplete: "off", placeholder: "اختیاری" }),
    });
    this.torobPriceInput = torobField.control as HTMLInputElement;

    const descriptionField = field("توضیحات", {
      control: h("textarea", { class: "input", attrs: { rows: "3", placeholder: "توضیح کوتاه دربارهٔ محصول (اختیاری)" } }),
    });
    this.descriptionInput = descriptionField.control as HTMLTextAreaElement;
    this.descriptionInput.value = initial?.description ?? "";

    const notesField = field("یادداشت", {
      control: h("textarea", { class: "input", attrs: { rows: "2", placeholder: "یادداشت داخلی (اختیاری)" } }),
    });
    this.notesInput = notesField.control as HTMLTextAreaElement;
    this.notesInput.value = initial?.notes ?? "";

    this.specArea = h("div", { class: "spec-list" });
    const addSpecBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, text: "＋ افزودن مشخصه" });
    addSpecBtn.addEventListener("click", () => this.addSpecRow());
    const specBlock = h(
      "div",
      { class: "field" },
      h("label", { class: "field-label", text: "مشخصات" }),
      this.specArea,
      h("div", { class: "field-hint", text: "مثلاً رنگ، گارانتی، حافظه" }),
      h("div", {}, addSpecBtn),
    );

    // تصویر
    this.imageInput = input("file", {});
    this.imageInput.type = "file";
    this.imageInput.accept = "image/*";
    this.imagePreview = h("div", { class: "image-uploader" });
    const pickBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, text: "انتخاب تصویر" });
    const clearBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, text: "حذف تصویر" });
    pickBtn.addEventListener("click", () => this.imageInput.click());
    clearBtn.addEventListener("click", () => {
      this.selectedImage = null;
      this.remoteImageUrl = null;
      this.imageInput.value = "";
      this.renderImage();
    });
    this.imageInput.addEventListener("change", () => {
      const file = this.imageInput.files?.[0];
      if (file && file.type.startsWith("image/")) {
        this.selectedImage = file;
        this.remoteImageUrl = null;
        this.renderImage();
        void compressImage(file)
          .then((optimized) => {
            if (this.selectedImage === file) {
              this.selectedImage = optimized;
              this.renderImage();
            }
          })
          .catch(() => {
            /* تصویر اصلی حفظ می‌شود */
          });
      } else {
        this.imageInput.value = "";
      }
    });
    const imageBlock = h(
      "div",
      { class: "field field-image" },
      h("label", { class: "field-label", text: "تصویر محصول" }),
      h("div", { class: "image-row" }, this.imagePreview, h("div", { class: "image-actions" }, pickBtn, this.imageInput, clearBtn)),
      h("div", { class: "field-hint", text: "تصویر به‌صورت محلی ذخیره می‌شود تا بدون اینترنت هم قابل نمایش باشد." }),
    );

    // لینک ترب (فقط نمایش)
    let torobBlock: HTMLElement | null = null;
    if (options.torobInfo) {
      torobBlock = h(
        "div",
        { class: "field torob-chip" },
        h("label", { class: "field-label", text: "منبع: ترب" }),
        h("p", { class: "torob-url", text: options.torobInfo.url }),
        h("p", { class: "torob-id", text: `شناسه: ${options.torobInfo.id}` }),
      );
    }

    const submitBtn = h("button", { class: "btn btn-primary", attrs: { type: "submit" }, text: options.submitLabel });
    const backBtn = options.onCancel
      ? h("button", { class: "btn btn-ghost", attrs: { type: "button" }, text: "بازگشت" })
      : null;
    backBtn?.addEventListener("click", () => {
      if (options.onCancel) options.onCancel();
    });

    const actions = h("div", { class: "form-actions" }, backBtn ?? null, submitBtn);

    this.element = h(
      "form",
      { class: "product-form" },
      h("div", { class: "form-grid" },
        nameField.element,
        categoryField.element,
        brandField.element,
        quantityField.element,
        purchaseField.element,
        sellingField.element,
        listPriceField.element,
        torobField.element,
      ),
      descriptionField.element,
      notesField.element,
      specBlock,
      imageBlock,
      torobBlock,
      actions,
    );

    this.element.addEventListener("submit", (e) => {
      e.preventDefault();
      const result = this.collect();
      this.onSubmitHandle(result);
    });

    if (initial?.specifications && initial.specifications.length > 0) {
      for (const spec of initial.specifications) this.addSpecRowAndSet(spec);
    } else {
      for (let i = 0; i < 2; i++) this.addSpecRow();
    }
    this.renderImage();

    if (this.categories.length > 0 && !document.getElementById("category-options")) {
      const datalist = h("datalist", { attrs: { id: "category-options" } });
      for (const cat of this.categories) {
        datalist.appendChild(h("option", { attrs: { value: cat } }));
      }
      document.body.appendChild(datalist);
    }
  }

  private onSubmitHandle: (result: ProductFormResult) => void = () => {};

  onSubmit(callback: (result: ProductFormResult) => void): void {
    this.onSubmitHandle = callback;
  }

  get value(): ProductFormResult {
    return this.collect();
  }

  private collect(): ProductFormResult {
    const qty = parseQuantityInput(this.quantityInput.value);
    const quantity = qty ?? (this.quantityInput.value.trim() === "" ? 0 : -1);
    const input: ProductInput = {
      name: this.nameInput.value,
      category: this.categoryInput.value,
      brand: this.brandInput.value,
      quantity,
      purchasePrice: parsePriceInput(this.purchaseInput.value),
      sellingPrice: parsePriceInput(this.sellingInput.value),
      listPrice: parsePriceInput(this.listPriceInput.value),
      torobPrice: parsePriceInput(this.torobPriceInput.value),
      torobUrl: null,
      torobId: null,
      image: this.selectedImage,
      imageUrl: this.selectedImage ? null : this.remoteImageUrl,
      description: this.descriptionInput.value,
      specifications: this.specRows
        .map((r) => ({ key: r.keyInput.value.trim(), value: r.valueInput.value.trim() }))
        .filter((s) => s.key || s.value),
      notes: this.notesInput.value,
    };
    const errors = validateProductInput(input);
    return { input, errors };
  }

  private addSpecRow(): void {
    this.addSpecRowAndSet({ key: "", value: "" });
  }

  private addSpecRowAndSet(spec: Specification): void {
    const keyInput = input("text", { value: spec.key, placeholder: "نام مشخصه", autocomplete: "off" });
    const valueInput = input("text", { value: spec.value, placeholder: "مقدار", autocomplete: "off" });
    const row = h(
      "div",
      { class: "spec-row" },
      keyInput,
      valueInput,
    );
    const removeBtn = h("button", { class: "spec-remove", attrs: { type: "button", "aria-label": "حذف مشخصه" }, text: "×" });
    removeBtn.addEventListener("click", () => {
      row.remove();
      this.specRows = this.specRows.filter((r) => r.container !== row);
    });
    row.appendChild(removeBtn);
    this.specArea.appendChild(row);
    this.specRows.push({ container: row, keyInput, valueInput });
  }

  private renderImage(): void {
    clear(this.imagePreview);
    let imageNode: HTMLImageElement | null = null;
    if (this.selectedImage) {
      const url = blobToObjectUrl(this.selectedImage);
      imageNode = new Image();
      imageNode.src = url;
      imageNode.decoding = "async";
    } else if (this.remoteImageUrl) {
      imageNode = new Image();
      imageNode.src = this.remoteImageUrl;
      imageNode.addEventListener("error", () => {
        imageNode?.classList.add("img-broken");
      });
    }
    if (imageNode) {
      imageNode.className = "product-image";
      imageNode.alt = "تصویر محصول";
      this.imagePreview.appendChild(imageNode);
    } else {
      this.imagePreview.appendChild(
        h("div", { class: "image-placeholder", text: "بدون تصویر" }),
      );
    }
  }

  /** نمایش خطاهای اعتبارسنجی داخل فرم */
  showErrors(errors: string[]): void {
    const existing = this.element.querySelector(".form-errors");
    existing?.remove();
    if (errors.length > 0) {
      const box = h(
        "div",
        { class: "form-errors", attrs: { role: "alert" } },
        ...errors.map((e) => h("p", { class: "form-error-item", text: e })),
      );
      this.element.prepend(box);
    }
  }
}

function buildQuantityControl(container: HTMLElement, initial: number): HTMLInputElement {
  const minus = h("button", { class: "btn qty-btn", attrs: { type: "button", "aria-label": "کاهش موجودی" }, text: "−" });
  const plus = h("button", { class: "btn qty-btn", attrs: { type: "button", "aria-label": "افزایش موجودی" }, text: "+" });
  const numberInput = input("number", { value: String(initial), min: "0", step: "1", inputmode: "numeric" });

  const updateVisibility = () => {
    const val = Number(numberInput.value);
    minus.disabled = !Number.isInteger(val) || val <= 0;
  };
  minus.addEventListener("click", () => {
    const val = parseQuantityInput(numberInput.value) ?? 0;
    if (val > 0) numberInput.value = String(val - 1);
    updateVisibility();
  });
  plus.addEventListener("click", () => {
    const val = parseQuantityInput(numberInput.value) ?? 0;
    numberInput.value = String(val + 1);
    updateVisibility();
  });
  numberInput.addEventListener("input", updateVisibility);
  updateVisibility();

  const wrap = h("div", { class: "quantity-control" }, minus, numberInput, plus);
  container.appendChild(wrap);
  return numberInput;
}

interface FieldControlResult {
  element: HTMLElement;
  control: HTMLElement;
}

function field(label: string, options: { control: HTMLElement; required?: boolean }): FieldControlResult {
  const labelEl = h("label", { class: "field-label", text: label });
  if (options.required) labelEl.classList.add("required");
  const element = h("div", { class: "field" }, labelEl, options.control);
  return { element, control: options.control };
}