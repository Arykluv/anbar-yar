import type { Invoice, PaymentType } from "../models/types";
import { formatJalali, toFaDigits, formatNumber } from "../utils/format";
import { DEFAULT_SELLER_NAME, PAYMENT_TYPE_LABELS } from "../db/SalesRepository";
import logoUrl from "../../logo.png?url";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** نام فایل HTML فاکتور */
export function invoiceFileName(number: number): string {
  return `factore-${number}.html`;
}

/** فیلدهای یک طرف فاکتور (فروشنده یا خریدار) */
interface PartyFields {
  name: string;
  nationalId: string;
  postalCode: string;
  phone: string;
  address: string;
}

function cleanShort(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.replace(/\s+/g, " ").slice(0, 50);
}

function cleanLong(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.replace(/\s+/g, " ").slice(0, 300);
}

/** تکمیل مقادیر پیش‌فرض برای فاکتورهای قدیمی که فیلد جدید ندارند */
function normalizeInvoice(invoice: {
  sellerName?: string;
  sellerNationalId?: string;
  sellerPostalCode?: string;
  sellerPhone?: string;
  sellerAddress?: string;
  buyerName?: string;
  buyerNationalId?: string;
  buyerPostalCode?: string;
  buyerPhone?: string;
  paymentType?: PaymentType;
}): { seller: PartyFields; buyer: PartyFields; paymentType: PaymentType } {
  return {
    seller: {
      name: invoice.sellerName?.trim() ? invoice.sellerName : DEFAULT_SELLER_NAME,
      nationalId: cleanShort(invoice.sellerNationalId),
      postalCode: cleanShort(invoice.sellerPostalCode),
      phone: cleanShort(invoice.sellerPhone),
      address: cleanLong(invoice.sellerAddress),
    },
    buyer: {
      name: invoice.buyerName?.trim() ? invoice.buyerName : "—",
      nationalId: cleanShort(invoice.buyerNationalId),
      postalCode: cleanShort(invoice.buyerPostalCode),
      phone: cleanShort(invoice.buyerPhone),
      address: "",
    },
    paymentType: invoice.paymentType === "credit" ? "credit" : "cash",
  };
}

/** کادر اطلاعات یک طرف فاکتور (نام + کد ملی + کد پستی + تلفن + آدرس) */
function partyInfoHtml(boxClass: string, title: string, party: PartyFields): string {
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    escapeHtml(party.name),
    party.nationalId ? `کد ملی: ${escapeHtml(party.nationalId)}` : "",
    party.postalCode ? `کد پستی: ${escapeHtml(party.postalCode)}` : "",
    party.phone ? `تلفن: ${escapeHtml(party.phone)}` : "",
    party.address ? `آدرس: ${escapeHtml(party.address)}` : "",
  ];
  return `<div class="${boxClass}">${lines.filter(Boolean).join("<br/>")}</div>`;
}

/**
 * ساخت HTML فاکتور فروش به‌صورت مستقل (برای دانلود و چاپ).
 * استایل کامل داخل سند است تا بدون نیاز به فایل اصلی برنامه، چاپ/ذخیره شود
 * و تمام محتوا در یک صفحهٔ A4 جای بگیرد.
 */
export function buildInvoiceHtml(
  invoice: Pick<Invoice, "number" | "createdAt" | "items" | "total"> & Partial<Pick<Invoice, "sellerName" | "sellerNationalId" | "sellerPostalCode" | "sellerPhone" | "sellerAddress" | "buyerName" | "buyerNationalId" | "buyerPostalCode" | "buyerPhone" | "paymentType">>,
  logoUri = "",
): string {
  const { seller, buyer, paymentType } = normalizeInvoice(invoice);
  const numberText = toFaDigits(String(invoice.number));
  const dateText = formatJalali(invoice.createdAt, true);
  const paymentLabel = PAYMENT_TYPE_LABELS[paymentType];
  const rows = invoice.items
    .map((item, index) => {
      const rowTotal = item.quantity * item.price;
      return `<tr>
        <td class="center">${toFaDigits(String(index + 1))}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="center">${toFaDigits(String(item.quantity))}</td>
        <td class="left">${escapeHtml(priceText(item.price))}</td>
        <td class="left">${escapeHtml(priceText(rowTotal))}</td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>فروشگاه ابزارآلات شیرعلی — فاکتور ${numberText}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Titr, "Titr Bold", Vazirmatn, Tahoma, "Segoe UI", Arial, sans-serif;
    color: #22303f;
    line-height: 1.6;
    background: #f7f8fa;
  }
  .invoice {
    width: 210mm;
    max-width: 100%;
    min-height: 297mm;
    margin: 0 auto;
    background: #ffffff;
    padding: 14mm 16mm;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1d4ed8;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  h1 { font-size: 20px; color: #1d4ed8; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .invoice-logo {
    height: 76px;
    width: auto;
    max-width: 40%;
    object-fit: contain;
    filter: drop-shadow(0 1px 2px rgba(30, 41, 59, 0.25));
  }
  .meta { text-align: left; font-size: 12px; color: #475569; }
  .meta div { margin-top: 2px; }
  .parties {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }
  .party {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 7px 11px;
    font-size: 12.5px;
    line-height: 1.7;
    background: #f8fafc;
  }
  .party b { color: #1d4ed8; display: block; font-size: 12px; margin-bottom: 1px; }
  .party.pay { background: #eef2ff; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
  th { background: #eef2ff; color: #1e293b; font-weight: 600; }
  td.left { text-align: left; }
  td.center { text-align: center; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .total-row { background: #eef2ff; font-weight: 700; }
  .total-row td:last-child { color: #1d4ed8; }
  .signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-top: 28px;
  }
  .sign-box {
    border-top: 1px dashed #94a3b8;
    padding-top: 6px;
    text-align: center;
    font-size: 12px;
    color: #64748b;
  }
  footer {
    margin-top: 16px;
    border-top: 1px dashed #cbd5e1;
    padding-top: 6px;
    font-size: 11px;
    color: #64748b;
    display: flex;
    justify-content: space-between;
  }
  @page { size: A4; margin: 0; }
  @media print {
    html, body { width: 210mm; height: 297mm; }
    body { background: #ffffff; }
    .invoice { margin: 0; box-shadow: none; border: none; }
  }
</style>
</head>
<body>
  <div class="invoice">
    <header>
      <div class="brand">
        <img class="invoice-logo" src="${logoUri}" alt="لوگوی فروشگاه ابزارآلات شیرعلی" />
        <h1>فروشگاه ابزارآلات شیرعلی</h1>
      </div>
      <div class="meta">
        <div>شمارهٔ فاکتور: <strong>${numberText}</strong></div>
        <div>تاریخ: ${escapeHtml(dateText)}</div>
      </div>
    </header>
    <div class="parties">
      ${partyInfoHtml("party", "فروشنده", seller)}
      ${partyInfoHtml("party", "خریدار", buyer)}
    </div>
    <table>
      <thead>
        <tr><th>ردیف</th><th>نام کالا</th><th>تعداد</th><th>قیمت واحد (تومان)</th><th>جمع (تومان)</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="4">جمع کل</td>
          <td>${escapeHtml(priceText(invoice.total))}</td>
        </tr>
      </tfoot>
    </table>
    <div class="parties totals">
      <div class="party pay"><b>نوع پرداخت</b>${escapeHtml(paymentLabel)}</div>
      <div class="party"><b>تعداد اقلام</b>${toFaDigits(String(invoice.items.reduce((s, it) => s + it.quantity, 0)))}</div>
    </div>
    <div class="signatures">
      <div class="sign-box">مهر و امضای فروشنده</div>
      <div class="sign-box">مهر و امضای خریدار</div>
    </div>
    <footer>
      <span>این سند به‌صورت الکترونیکی صادر شده است.</span>
      <span>ابزار آلات شیرعلی — مدیریت: بابک شیرعلی</span>
    </footer>
  </div>
</body>
</html>`;
}

/** لوگوی فروشگاه به‌صورت داده‌URI؛ فقط هنگام چاپ فاکتور واکشی می‌شود */
let logoCache: string | null = null;
let logoPromise: Promise<string> | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** بارگذاری تنبل لوگو (به‌صورت فایل جدا از باندل اصلی) و کش آن */
export function preloadInvoiceLogo(): Promise<string> {
  if (logoCache !== null) return Promise.resolve(logoCache);
  if (!logoPromise) {
    logoPromise = (async () => {
      try {
        const res = await fetch(logoUrl, { cache: "force-cache" });
        if (!res.ok) return "";
        return await blobToDataUrl(await res.blob());
      } catch {
        return "";
      }
    })().then((value) => {
      logoCache = value;
      return value;
    });
  }
  return logoPromise;
}

/** فاکتور کامل با لوگو؛ لوگو فقط در اولین چاپ واکشی می‌شود (حالت ناهمگام) */
export async function buildInvoiceHtmlWithLogo(
  invoice: Parameters<typeof buildInvoiceHtml>[0],
): Promise<string> {
  const logo = await preloadInvoiceLogo();
  return buildInvoiceHtml(invoice, logo);
}

/** تبدیل عدد به متن تومانی (ارقام فارسی + جداکننده، بدون واحد) */
function priceText(value: number): string {
  return `${toFaDigits(formatNumber(Math.round(value)))} تومان`;
}

/** دانلود فاکتور به‌صورت فایل HTML */
export function downloadInvoiceHtml(html: string, number: number): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = invoiceFileName(number);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * باز کردن فاکتور در پنجرهٔ جدید و باز کردن دیالوگ چاپ.
 * کاربر می‌تواند «ذخیره به‌صورت PDF» را انتخاب کند.
 * اگر پنجره بسته شود (مسدود شدن popup) false برمی‌گرداند.
 */
export function printInvoice(html: string): boolean {
  const win = window.open("", "_blank", "width=920,height=720");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    try {
      win.print();
    } catch {
      /* برخی مرورگرها در حالت‌های خاص اجازهٔ چاپ خودکار نمی‌دهند */
    }
  }, 350);
  return true;
}

/** نمایش خلاصهٔ متنی یک فاکتور برای گفت‌وگوی تأیید */
export function invoiceSummaryText(
  invoice: Pick<Invoice, "number" | "items" | "total"> & Partial<Pick<Invoice, "sellerName" | "buyerName" | "paymentType">>,
): string {
  const { buyer, paymentType } = normalizeInvoice(invoice);
  const lines: string[] = [];
  if (buyer.name !== "—") lines.push(`خریدار: ${buyer.name}`);
  if (buyer.phone) lines.push(`تلفن خریدار: ${buyer.phone}`);
  lines.push(`نوع پرداخت: ${PAYMENT_TYPE_LABELS[paymentType]}`);
  for (const item of invoice.items) {
    lines.push(`• ${item.name}: ${toFaDigits(String(item.quantity))} × ${priceText(item.price)}`);
  }
  lines.push(`جمع کل: ${priceText(invoice.total)}`);
  return lines.join("\n");
}