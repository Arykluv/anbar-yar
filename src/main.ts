import "./styles/main.css";
import { initApp } from "./app/App";
import { applySystemThemeSync, applyAppearance } from "./app/theme";

applySystemThemeSync();
void applyAppearance();
initApp();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        console.info("[anbar] سرویس‌کاربر (PWA) فعال شد:", reg.scope);
      })
      .catch((err) => {
        console.warn("[anbar] ثبت سرویس‌کاربر ناموفق بود:", err);
      });
  });
}