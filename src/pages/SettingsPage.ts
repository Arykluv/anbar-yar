import { h, input } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { toast } from "../app/toast";
import { confirmDialog } from "../app/modal";
import { notifyDataChanged } from "../app/events";
import { db } from "../db/InventoryDB";
import { productRepository } from "../db/ProductRepository";
import { AppError } from "../services/errors";
import {
  AUTO_BACKUP_INTERVAL_MS,
  backupInvoiceToInvoice,
  defaultBackupFileName,
  exportBackup,
  lastAutoBackupDate,
  parseBackupText,
  buildImportPlan,
  performAutoBackup,
} from "../services/BackupService";
import { card, pageHeader } from "./page";
import { formatJalali, formatNumber, toFaDigits } from "../utils/format";
import { currentThemePreference, isLite, setLite, setTheme, type AppTheme } from "../app/theme";

const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "dark", label: "تیره" },
  { value: "auto", label: "سیستم" },
];

export function renderSettings(container: HTMLElement, _route: Route): PageCleanup {
  const header = pageHeader("تنظیمات", null, "ظاهر، داده‌ها و پشتیبان‌گیری");
  const main = h("div", { class: "settings" });
  container.append(header, main);

  // ---- Appearance ----
  const liteInput = h("input", { attrs: { type: "checkbox", id: "lite-toggle" } }) as HTMLInputElement;
  liteInput.checked = isLite();
  liteInput.addEventListener("change", () => {
    liteInput.disabled = true;
    void setLite(liteInput.checked)
      .catch(() => toast("تغییر حالت سبک انجام نشد.", "error"))
      .finally(() => {
        liteInput.disabled = false;
      });
  });

  main.appendChild(
    card(
      { class: "settings-card", title: "ظاهر" },
      h("p", { class: "section-desc", text: "نمایش روشن، تیره یا پیروی از سیستم عامل (سیستم)" }),
      h("div", { class: "theme-picker" },
        h("span", { class: "theme-indicator", attrs: { "aria-hidden": "true" } }),
        ...THEME_OPTIONS.map((opt) => themeButton(opt)),
      ),
      h(
        "label",
        { class: "lite-switch" },
        liteInput,
        h("span", { class: "lite-switch-text" },
          h("span", { class: "lite-switch-name", text: "حالت سبک" }),
          h("span", { class: "field-hint", text: "غیرفعال‌کردن افکت‌های سنگین (شیشه، سایه و انیمیشن) برای رایانه‌های ضعیف" }),
        ),
        h("span", { class: "lite-switch-track", attrs: { "aria-hidden": "true" } }, h("span", { class: "lite-switch-knob" })),
      ),
    ),
  );
  syncThemeButtons();

  void renderDataOverview(main);

  // ---- Backup ----
  const exportBtn = h("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "خروجی گرفتن از اطلاعات" });
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    try {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = defaultBackupFileName();
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("فایل پشتیبان با موفقیت ساخته شد.", "success");
    } catch (err) {
      toast("تهیهٔ پشتیبان با مشکل مواجه شد.", "error");
      console.error("[anbar] خطای خروجی گرفتن:", err);
    } finally {
      exportBtn.disabled = false;
    }
  });

  main.appendChild(
    card(
      { class: "settings-card", title: "پشتیبان‌گیری" },
      h("p", { class: "section-desc", text: "تمام اطلاعات انبار (محصولات، فاکتورها، تصاویر و تنظیمات) در یک فایل JSON روی رایانه شما ذخیره می‌شود." }),
      h("div", { class: "settings-action" }, exportBtn),
    ),
  );

  // ---- پشتیبان‌گیری خودکار ----
  void renderAutoBackupCard(main);

  // ---- Restore ----
  const modeSelect = h("select", { attrs: { "aria-label": "حالت بازیابی" } },
    h("option", { attrs: { value: "replace" }, text: "جایگزینی کامل" }),
    h("option", { attrs: { value: "merge" }, text: "افزودن به اطلاعات فعلی" }),
  );
  const fileInput = input("file", {});
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  const fileLabel = h("label", { class: "btn btn-ghost file-picker" },
    h("span", { text: "انتخاب فایل پشتیبان" }), fileInput,
  );
  const restoreBtn = h("button", { class: "btn btn-primary", attrs: { type: "button", disabled: "true" }, text: "بازیابی اطلاعات" });

  let selectedFile: File | null = null;
  fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files?.[0] ?? null;
    restoreBtn.disabled = !selectedFile;
    fileLabel.classList.toggle("has-file", Boolean(selectedFile));
  });

  restoreBtn.addEventListener("click", async () => {
    if (!selectedFile) {
      toast("ابتدا یک فایل پشتیبان انتخاب کنید.", "error");
      return;
    }
    if (!(modeSelect.value === "replace" || modeSelect.value === "merge")) return;
    const mode = modeSelect.value;
    restoreBtn.disabled = true;
    try {
      const text = await selectedFile.text();
      const backup = parseBackupText(text);
      const existing = await productRepository.findAll();
      const plan = await buildImportPlan(backup, mode, existing);

      if (plan.toAdd.length === 0 && mode === "merge") {
        toast("چیزی برای افزودن وجود نداشت؛ همهٔ محصولات تکراری بودند.", "info", 6000);
        restoreBtn.disabled = false;
        return;
      }
      if (plan.toAdd.length === 0 && mode === "replace") {
        toast("فایل پشتیبان محصولی ندارد.", "error", 6000);
        restoreBtn.disabled = false;
        return;
      }

      const summary = mode === "replace"
        ? `${plan.toAdd.length} محصول و ${toFaDigits(String(backup.invoices?.length ?? 0))} فاکتور جایگزین داده‌های فعلی خواهد شد.`
        : `${plan.toAdd.length} محصول جدید اضافه می‌شود؛ ${toFaDigits(plan.skippedTorob + plan.skippedName)} محصول تکراری رها می‌شود.`;

      const accepted = await confirmDialog({
        title: "تأیید بازیابی اطلاعات",
        message: `${summary}\nدر حالت «جایگزینی کامل» داده‌های فعلی (محصولات و فاکتورها) پاک می‌شود. ادامه می‌دهید؟`,
        confirmLabel: "بله، بازیابی انجام شود",
        danger: mode === "replace",
      });
      if (!accepted) {
        restoreBtn.disabled = false;
        return;
      }

      if (mode === "replace") {
        const restoredInvoices = (backup.invoices ?? []).map(backupInvoiceToInvoice);
        const validSettings = (backup.settings ?? []).filter((s) => s.key);
        await db.transaction("rw", db.products, db.priceHistory, db.invoices, db.settings, async () => {
          await db.products.clear();
          await db.priceHistory.clear();
          await db.invoices.clear();
          await db.settings.clear();
          await db.products.bulkAdd(plan.toAdd.map(({ id: _i, ...rest }) => rest));
          if (restoredInvoices.length > 0) await db.invoices.bulkAdd(restoredInvoices);
          if (validSettings.length > 0) await db.settings.bulkAdd(validSettings.map((s) => ({ key: s.key, value: s.value })));
        });
        toast(`بازیابی کامل انجام شد؛ ${plan.toAdd.length} محصول و ${toFaDigits(String(restoredInvoices.length))} فاکتور بازیابی شد.`, "success");
      } else {
        await db.products.bulkAdd(plan.toAdd.map(({ id: _i, ...rest }) => rest));
        toast(`${plan.toAdd.length} محصول به اطلاعات فعلی اضافه شد.`, "success");
      }
      notifyDataChanged();
    } catch (err) {
      toast(err instanceof AppError ? err.userMessage : "بازیابی اطلاعات ناموفق بود.", "error", 7000);
      console.error("[anbar] خطای بازیابی:", err);
    } finally {
      restoreBtn.disabled = false;
    }
  });

  main.appendChild(
    card(
      { class: "settings-card", title: "بازیابی اطلاعات" },
      h("p", { class: "section-desc", text: "فایل پشتیبان قبلی را انتخاب کنید. قبل از بازیابی، فایل اعتبارسنجی می‌شود." }),
      h("div", { class: "restore-row" }, fileLabel, modeSelect, restoreBtn),
      h("p", { class: "field-hint", text: "در حالت جایگزینی کامل، تمام داده‌های فعلی پاک می‌شوند." }),
    ),
  );

  // ---- Danger zone ----
  const wipeBtn = h("button", { class: "btn btn-danger btn-block", attrs: { type: "button" }, text: "حذف همهٔ داده‌ها" });
  wipeBtn.addEventListener("click", async () => {
    const count = await productRepository.findAll().then((p) => p.length).catch(() => 0);
    const ok = await confirmDialog({
      title: "پاک کردن همهٔ داده‌ها",
      message: `همهٔ ${toFaDigits(String(count))} محصول و تاریخچه‌ها به‌صورت کامل حذف می‌شوند. قبل از این کار حتماً پشتیبان بگیرید. ادامه می‌دهید؟`,
      confirmLabel: "بله، همه پاک شود",
      danger: true,
    });
    if (!ok) return;
    try {
      await db.transaction("rw", db.products, db.priceHistory, db.settings, async () => {
        await db.products.clear();
        await db.priceHistory.clear();
        await db.settings.clear();
      });
      notifyDataChanged();
      toast("همهٔ داده‌ها پاک شد.", "success");
    } catch (err) {
      toast("پاک کردن داده‌ها ناموفق بود.", "error");
      console.error("[anbar] خطای پاک کردن:", err);
    }
  });

  main.appendChild(
    card(
      { class: "settings-card danger-zone", title: "منطقهٔ خطر" },
      h("p", { class: "section-desc", text: "این عمل غیرقابل بازگشت است. حتماً ابتدا پشتیبان بگیرید." }),
      wipeBtn,
    ),
  );

  // ---- About ----
  main.appendChild(
    card(
      { class: "settings-card", title: "دربارهٔ برنامه" },
      h("ul", { class: "about-list" },
        h("li", { text: "نرم‌افزار انبارنگار" }),
        h("li", { text: "نسخه: ۱.۰.۰" }),
        h("li", { text: "ذخیره‌سازی: کاملاً محلی در مرورگر (IndexedDB) — نیازی به سرور یا اینترنت نیست." }),
        h("li", { text: "حالت آفلاین: پس از اولین بارگذاری، بدون اینترنت نیز کار می‌کند." }),
        h("li", { text: "واحد قیمت: تومان" }),
      ),
    ),
  );

  const off = () => {};
  return off;
}

function themeButton(opt: { value: AppTheme; label: string }): HTMLElement {
  const btn = h("button", {
    class: "theme-btn",
    attrs: { type: "button", "data-theme-pick": opt.value },
    text: opt.label,
  });
  const isActive = currentThemePreference() === opt.value;
  btn.classList.toggle("active", isActive);
  if (isActive) btn.setAttribute("aria-pressed", "true");
  else btn.setAttribute("aria-pressed", "false");

  btn.addEventListener("click", () => {
    btn.disabled = true;
    void setTheme(opt.value)
      .catch(() => toast("تغییر تم انجام نشد.", "error"))
      .finally(() => {
        btn.disabled = false;
        syncThemeButtons();
      });
  });
  return btn;
}

function syncThemeButtons(): void {
  const selected = currentThemePreference();
  let active: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>("[data-theme-pick]")) {
    const isActive = el.getAttribute("data-theme-pick") === selected;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (isActive) active = el;
  }
  const indicator = document.querySelector<HTMLElement>(".theme-indicator");
  if (!indicator || !active) return;
  const btnRect = active.getBoundingClientRect();
  indicator.style.width = `${active.offsetWidth}px`;
  const indRect = indicator.getBoundingClientRect();
  indicator.style.transform = `translateX(${btnRect.left - indRect.left}px)`;
}

async function renderAutoBackupCard(main: HTMLElement): Promise<void> {
  const infoLine = h("p", { class: "field-hint", text: "در حال بررسی..." });
  const button = h("button", { class: "btn btn-ghost", attrs: { type: "button" }, text: "پشتیبان‌گیری خودکار همین حالا" });

  async function refreshInfo(): Promise<void> {
    const last = await lastAutoBackupDate();
    const label = last
      ? `آخرین پشتیبان‌گیری خودکار: ${formatJalali(last, true)}`
      : "هنوز پشتیبان‌گیری خودکاری انجام نشده است.";
    infoLine.textContent = label;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "در حال پشتیبان‌گیری...";
    try {
      const result = await performAutoBackup();
      toast(result.message, result.ok ? "success" : "error", 7000);
      await refreshInfo();
    } catch (err) {
      toast("پشتیبان‌گیری خودکار ممکن نشد.", "error", 7000);
      console.error("[anbar] پشتیبان‌گیری خودکار:", err);
    } finally {
      button.disabled = false;
      button.textContent = "پشتیبان‌گیری خودکار همین حالا";
    }
  });

  main.appendChild(
    card(
      { class: "settings-card", title: "پشتیبان‌گیری خودکار" },
      h("p", { class: "section-desc", text: `با اجرای برنامه، هر ${toFaDigits(String(Math.round(AUTO_BACKUP_INTERVAL_MS / (24 * 60 * 60 * 1000))))} روز یک پشتیبان کامل به‌صورت خودکار ذخیره می‌شود: در پوشهٔ backup کنار فایل اجرایی (نسخهٔ Portable) یا در پوشهٔ کاربری برنامه (نسخهٔ نصب‌شده).` }),
      infoLine,
      h("div", { class: "settings-action" }, button),
    ),
  );

  void refreshInfo();
}

async function renderDataOverview(main: HTMLElement): Promise<void> {
  const chips = [
    h("span", { class: "storage-chip", text: "محصولات: …" }),
    h("span", { class: "storage-chip", text: "موجود: …" }),
    h("span", { class: "storage-chip", text: "ناموجود: …" }),
    h("span", { class: "storage-chip", text: "رکوردهای تنظیمات: …" }),
  ];
  const status = h("p", { class: "field-hint", text: "در حال بررسی..." });
  const overview = h("div", { class: "storage-info" }, ...chips);
  main.appendChild(card({ class: "settings-card", title: "وضعیت داده‌ها" }, overview, status));

  try {
    const [stats, settingsCount, dbCheck] = await Promise.all([
      productRepository.stats(),
      db.settings.count(),
      db.products.count(),
    ]);
    chips[0].textContent = `محصولات: ${toFaDigits(formatNumber(stats.total))}`;
    chips[1].textContent = `موجود: ${toFaDigits(formatNumber(stats.available))}`;
    chips[2].textContent = `ناموجود: ${toFaDigits(formatNumber(stats.unavailable))}`;
    chips[3].textContent = `رکوردهای تنظیمات: ${toFaDigits(settingsCount)}`;
    status.textContent = `بانک محلی اصلی: ${toFaDigits(dbCheck)} رکورد محصول`;
  } catch {
    status.textContent = "خواندن وضعیت داده‌ها ممکن نشد.";
    for (const chip of chips) chip.textContent = chip.textContent.replace("…", "—");
  }
}