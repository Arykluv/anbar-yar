/** مشخصات یک کالا (جفت کلید/مقدار) */
export type Specification = { key: string; value: string };

/** یک ردیف در فاکتور فروش */
export interface InvoiceItem {
  name: string;
  quantity: number;
  price: number;
  productId: number | null;
}

/** نوع پرداخت در فاکتور */
export type PaymentType = "cash" | "credit";

/** فاکتور فروش ثبت‌شده */
export interface Invoice {
  id?: number;
  number: number;
  createdAt: Date;
  sellerName: string;
  sellerNationalId: string;
  sellerPostalCode: string;
  sellerPhone: string;
  sellerAddress: string;
  buyerName: string;
  buyerNationalId: string;
  buyerPostalCode: string;
  buyerPhone: string;
  paymentType: PaymentType;
  items: InvoiceItem[];
  total: number;
  /** مجموع مبلغ کالاها قبل از تخفیف */
  subtotal?: number;
  /** تخفیف درصدی روی فاکتور (۰ تا ۱۰۰) */
  discountPercent?: number;
  /** مبلغ تخفیف = مجموع کالاها × درصد تخفیف */
  discountAmount?: number;
}

/** وضعیت موجودی یک کالا */
export type Availability = "available" | "unavailable";

/** فیلدهای قابل وارد کردن برای ساخت یا ویرایش محصول */
export interface ProductInput {
  name: string;
  category: string;
  brand: string;
  quantity: number;
  purchasePrice: number | null;
  sellingPrice: number | null;
  torobPrice: number | null;
  listPrice: number | null;
  torobUrl: string | null;
  torobId: string | null;
  image: Blob | null;
  imageUrl: string | null;
  description: string;
  specifications: Specification[];
  notes: string;
}

/** سطر ذخیره‌شده در بانک محلی */
export interface Product extends ProductInput {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

/** تنظیمات برنامه (جدول settings در IndexedDB) */
export interface Setting {
  key: string;
  value: string | number | boolean | null;
}

/** ورودی یک رکورد تاریخچه قیمت (برای توسعه آینده) */
export interface PriceHistoryEntry {
  id?: number;
  productId: number;
  field: "purchasePrice" | "sellingPrice" | "torobPrice" | "listPrice" | "quantity";
  oldValue: number | null;
  newValue: number | null;
  changedAt: Date;
}

/** ساختار فایل پشتیبان */
export interface BackupFile {
  version: number;
  app: "anbar";
  exportedAt: string;
  products: BackupProduct[];
  settings: BackupSetting[];
  invoices: BackupInvoice[];
}

/** فاکتور ذخیره‌شده در فایل پشتیبان (تاریخ به‌صورت رشته) */
export interface BackupInvoice {
  id?: number;
  number: number;
  createdAt: string;
  sellerName: string;
  sellerNationalId: string;
  sellerPostalCode: string;
  sellerPhone: string;
  sellerAddress: string;
  buyerName: string;
  buyerNationalId: string;
  buyerPostalCode: string;
  buyerPhone: string;
  paymentType: PaymentType;
  items: InvoiceItem[];
  total: number;
  subtotal?: number;
  discountPercent?: number;
  discountAmount?: number;
}

export type BackupProduct = Omit<Product, "image" | "createdAt" | "updatedAt"> & {
  imageDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupSetting = { key: string; value: string | number | boolean | null };