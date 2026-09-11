import { db } from "./InventoryDB";
import type { Setting } from "../models/types";

/** مخزن تنظیمات ساده (key/value) */
class SettingsRepository {
  async get(key: string): Promise<Setting | undefined> {
    return db.settings.get(key);
  }

  async set(key: string, value: Setting["value"]): Promise<void> {
    await db.settings.put({ key, value });
  }

  async remove(key: string): Promise<void> {
    await db.settings.delete(key);
  }

  async all(): Promise<Setting[]> {
    return db.settings.toArray();
  }
}

export const settingsRepository = new SettingsRepository();

/** ثبت رویداد تغییر قیمت/موجودی؛ برای توسعهٔ آینده‌ی «تاریخچه قیمت» */
export async function recordPriceHistory(entry: {
  productId: number;
  field: "purchasePrice" | "sellingPrice" | "torobPrice" | "listPrice" | "quantity";
  oldValue: number | null;
  newValue: number | null;
  changedAt: Date;
}): Promise<void> {
  if (entry.oldValue === entry.newValue) return;
  try {
    await db.priceHistory.add(entry);
  } catch (err) {
    console.error("[anbar] خطا در ثبت تاریخچه قیمت:", err);
  }
}