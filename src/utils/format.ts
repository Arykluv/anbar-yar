/** تبدیل ارقام به فارسی */
export function toFaDigits(value: number | string): string {
  const str = String(value);
  return str.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

/** تبدیل ارقام فارسی/عربی به انگلیسی */
export function toEnDigits(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** جداکننده هزارگان */
export function formatNumber(value: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "۰";
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return decPart ? `${withCommas}.${decPart}` : withCommas;
}

/** قالب‌بندی قیمت با واحد تومان */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${toFaDigits(formatNumber(value))} تومان`;
}

/** وضعیت به شکل متنی فارسی */
export function availabilityLabel(available: boolean): string {
  return available ? "موجود" : "ناموجود";
}

const MONTH_NAMES = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export interface JalaliDate {
  year: number;
  month: number;
  day: number;
}

// ---------- الگوریتم تبدیل میلادی به جلالی (jalali-js, MIT) ----------
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function div(a: number, b: number): number {
  return ~~(a / b);
}
function mod(a: number, b: number): number {
  return a - ~~(a / b) * b;
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function jalCal(jy: number): { leap: number; march: number } {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0] ?? -61;
  let jump = 0;
  if (jy < (BREAKS[0] ?? -61) || jy >= (BREAKS[BREAKS.length - 1] ?? 3178)) {
    throw new Error("سال جلالی خارج از محدوده");
  }
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i] ?? 0;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, march };
}

function d2j(jdn: number): JalaliDate {
  const gy = d2g(jdn);
  let jy = gy.gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy.gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
    } else {
      k -= 186;
      jm = 7 + div(k, 30);
      jd = mod(k, 30) + 1;
    }
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
  }
  return { year: jy, month: jm, day: jd };
}

/** تبدیل تاریخ میلادی به تاریخ جلالی */
export function toJalali(date: Date): JalaliDate {
  return d2j(g2d(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

/** نمایش تاریخ جلالی: ۱۴۰۵/۰۶/۱۳ */
export function formatJalali(date: Date, withTime = false): string {
  const j = toJalali(date);
  const mm = String(j.month).padStart(2, "0");
  const dd = String(j.day).padStart(2, "0");
  const datePart = `${toFaDigits(j.year)}/${toFaDigits(mm)}/${toFaDigits(dd)}`;
  if (!withTime) return datePart;
  const hh = toFaDigits(String(date.getHours()).padStart(2, "0"));
  const min = toFaDigits(String(date.getMinutes()).padStart(2, "0"));
  return `${datePart} — ${hh}:${min}`;
}

/** ۱۳ شهریور ۱۴۰۵ */
export function formatJalaliLong(date: Date): string {
  const j = toJalali(date);
  return `${toFaDigits(j.day)} ${MONTH_NAMES[j.month - 1] ?? ""} ${toFaDigits(j.year)}`;
}

/** نام فایل پشتیبان با تاریخ جلالی: inventory-backup-1405-06-13.json */
export function backupFileName(date = new Date()): string {
  const j = toJalali(date);
  const mm = String(j.month).padStart(2, "0");
  const dd = String(j.day).padStart(2, "0");
  return `inventory-backup-${j.year}-${mm}-${dd}.json`;
}