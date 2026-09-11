import { db } from "../db/InventoryDB";

/** تم برنامه: پیروی از سیستم، روشن یا تیره */
export type AppTheme = "auto" | "light" | "dark";

export const THEME_SETTING_KEY = "theme";
export const LITE_SETTING_KEY = "lite";

const THEME_LOCAL_KEY = "anbar-theme";
const LITE_LOCAL_KEY = "anbar-lite";

const systemDark = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;

let systemQuery: MediaQueryList | null | undefined =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** تبدیل انتخاب کاربر به تم مؤثر */
export function resolveTheme(preference: AppTheme): "light" | "dark" {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark() ? "dark" : "light";
}

function apply(value: "light" | "dark"): void {
  const root = document.documentElement;
  root.dataset.theme = value;
  root.style.colorScheme = value;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", value === "dark" ? "#06070c" : "#f4f5f9");
}

let currentPreference: AppTheme = "auto";
let liteEnabled = false;

/** اعمال فوری تم پیرو سیستم (برای جلوگیری از فلش قبل از خواندن تنظیمات) */
export function applySystemThemeSync(): void {
  currentPreference = "auto";
  apply(resolveTheme("auto"));
}

function applyLiteToDom(): void {
  const root = document.documentElement;
  if (liteEnabled) root.dataset.lite = "1";
  else delete root.dataset.lite;
}

function defineLite(value: unknown): boolean {
  return value === "1" || value === "true" || value === true;
}

/** بازخوانی تم و حالت سبک ذخیره‌شده و اعمال آن‌ها */
export async function applyAppearance(): Promise<void> {
  try {
    const entries = await db.settings.bulkGet([THEME_SETTING_KEY, LITE_SETTING_KEY]);
    const themeValue = entries.find((e) => e?.key === THEME_SETTING_KEY)?.value;
    const liteValue = entries.find((e) => e?.key === LITE_SETTING_KEY)?.value;
    currentPreference = themeValue === "light" || themeValue === "dark" || themeValue === "auto" ? themeValue : "auto";
    liteEnabled = defineLite(liteValue);
  } catch {
    currentPreference = "auto";
    liteEnabled = false;
  }
  apply(resolveTheme(currentPreference));
  applyLiteToDom();
  cacheLocal();
}

/** هم‌خوانی سازگار با نسخهٔ قبلی */
export async function applyTheme(): Promise<void> {
  await applyAppearance();
}

function cacheLocal(): void {
  try {
    localStorage.setItem(THEME_LOCAL_KEY, currentPreference);
    localStorage.setItem(LITE_LOCAL_KEY, liteEnabled ? "1" : "0");
  } catch {
    /* نادیده گرفته می‌شود */
  }
}

/** تغییر تم توسط کاربر و ذخیره در تنظیمات */
export async function setTheme(preference: AppTheme): Promise<void> {
  currentPreference = preference;
  await db.settings.put({ key: THEME_SETTING_KEY, value: preference });
  apply(resolveTheme(preference));
  cacheLocal();
}

/** تغییر حالت سبک و ذخیره در تنظیمات */
export async function setLite(enabled: boolean): Promise<void> {
  liteEnabled = enabled;
  await db.settings.put({ key: LITE_SETTING_KEY, value: enabled ? "1" : "0" });
  applyLiteToDom();
  cacheLocal();
}

/** انتخاب فعلی کاربر برای تم */
export function currentThemePreference(): AppTheme {
  return currentPreference;
}

/** آیا حالت سبک (بهینه برای رایانه‌های ضعیف) فعال است؟ */
export function isLite(): boolean {
  return liteEnabled;
}

if (systemQuery) {
  systemQuery.addEventListener("change", () => {
    if (currentPreference === "auto") apply(resolveTheme("auto"));
  });
}