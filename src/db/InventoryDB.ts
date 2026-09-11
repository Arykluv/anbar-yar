import Dexie, { type EntityTable } from "dexie";
import type { Invoice, PriceHistoryEntry, Product, Setting } from "../models/types";

export const DB_NAME = "anbar-inventory-db";
export const DB_VERSION = 2;

export class InventoryDB extends Dexie {
  products!: EntityTable<Product, "id">;
  settings!: EntityTable<Setting, "key">;
  priceHistory!: EntityTable<PriceHistoryEntry, "id">;
  invoices!: EntityTable<Invoice, "id">;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      products: "++id, name, torobId, torobUrl, category, brand, createdAt, updatedAt, quantity",
      settings: "key",
      priceHistory: "++id, productId, changedAt",
    });
    this.version(2).stores({
      products: "++id, name, torobId, torobUrl, category, brand, createdAt, updatedAt, quantity",
      settings: "key",
      priceHistory: "++id, productId, changedAt",
      invoices: "++id, number, createdAt, total",
    });
  }
}

export const db = new InventoryDB();

export interface DatabaseStatus {
  ok: boolean;
  message: string;
}

/** تست اولیهٔ دسترسی به بانک محلی */
export async function checkDatabase(): Promise<DatabaseStatus> {
  try {
    const count = await db.products.count();
    return { ok: true, message: `بانک محلی فعال است (${count} محصول).` };
  } catch (err) {
    console.error("[anbar] خطا در دسترسی به بانک محلی:", err);
    return { ok: false, message: "امکان دسترسی به بانک محلی وجود ندارد. لطفاً مرورگر را بررسی کنید." };
  }
}