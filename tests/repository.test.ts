import { beforeEach, describe, expect, it } from "vitest";
import { productRepository, filterProducts, sortProducts, type ProductFilter } from "../src/db/ProductRepository";
import { db } from "../src/db/InventoryDB";
import { AppError } from "../src/services/errors";
import type { ProductInput } from "../src/models/types";

function makeInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: "کالای آزمایشی",
    category: "کالای دیجیتال",
    brand: "برند X",
    quantity: 10,
    purchasePrice: 100000,
    sellingPrice: 120000,
    torobPrice: null,
    listPrice: null,
    torobUrl: null,
    torobId: null,
    image: null,
    imageUrl: null,
    description: "توضیح",
    specifications: [],
    notes: "",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.transaction("rw", db.products, db.priceHistory, db.settings, async () => {
    await db.products.clear();
    await db.priceHistory.clear();
    await db.settings.clear();
  });
});

describe("مخزن محصولات", () => {
  it("محصول می‌سازد و آن را می‌خواند", async () => {
    const created = await productRepository.create(makeInput({ name: "موبایل" }));
    const found = await productRepository.findById(created.id);
    expect(found?.name).toBe("موبایل");
    expect(found?.quantity).toBe(10);
    expect(found).toHaveProperty("createdAt");
  });

  it("موجودی منفی را با خطا رد می‌کند", async () => {
    await expect(productRepository.create(makeInput({ quantity: -1 }))).rejects.toBeInstanceOf(AppError);
  });

  it("محصول تکراری با لینک ترب را تشخیص می‌دهد", async () => {
    await productRepository.create(makeInput({ name: "گوشی", torobId: "abc123", torobUrl: "https://torob.com/p/abc123/" }));
    await expect(productRepository.create(makeInput({ name: "گوشی", torobId: "abc123" }))).rejects.toThrow(/قبلاً/);
  });

  it("محصول تکراری با نام یکسان را تشخیص می‌دهد", async () => {
    await productRepository.create(makeInput({ name: "لپ‌تاپ" }));
    await expect(productRepository.create(makeInput({ name: "لپ تاپ" }))).rejects.toThrow(/قبلاً/);
  });

  it("محصول را ویرایش می‌کند", async () => {
    const created = await productRepository.create(makeInput({ quantity: 5 }));
    const updated = await productRepository.update(created.id, { quantity: 8, sellingPrice: 90000 });
    expect(updated.quantity).toBe(8);
    expect(updated.sellingPrice).toBe(90000);
  });

  it("ویرایش به سقف موجودی منفی نمی‌رسد", async () => {
    const created = await productRepository.create(makeInput({ quantity: 5 }));
    await expect(productRepository.update(created.id, { quantity: -2 })).rejects.toBeInstanceOf(AppError);
  });

  it("افزایش و کاهش موجودی را انجام می‌دهد", async () => {
    const created = await productRepository.create(makeInput({ quantity: 3 }));
    await productRepository.adjustQuantity(created.id, 2);
    expect((await productRepository.findById(created.id))?.quantity).toBe(5);
    await expect(productRepository.adjustQuantity(created.id, -10)).rejects.toThrow(/منفی/);
  });

  it("محصول را حذف می‌کند", async () => {
    const created = await productRepository.create(makeInput());
    await productRepository.remove(created.id);
    expect(await productRepository.findById(created.id)).toBeUndefined();
  });

  it("آمار موجود/ناموجود را درست برمی‌گرداند", async () => {
    await productRepository.create(makeInput({ quantity: 3, torobId: "s1" }));
    await productRepository.create(makeInput({ quantity: 0, torobId: "s2" }));
    await productRepository.create(makeInput({ quantity: 1, torobId: "s3" }));
    const stats = await productRepository.stats();
    expect(stats).toEqual({ total: 3, available: 2, unavailable: 1 });
  });
});

describe("فیلتر و مرتب‌سازی", () => {
  it("بر اساس عبارت جستجو فیلتر می‌کند", async () => {
    const a = await productRepository.create(makeInput({ name: "آیفون ۱۵" }));
    const b = await productRepository.create(makeInput({ name: "سامسونگ A54", category: "موبایل" }));
    void a;
    const filter: ProductFilter = { q: "سامسونگ", category: "", availability: "all", sort: "name" };
    const result = filterProducts(await productRepository.findAll(), filter);
    expect(result.map((p) => p.name)).toEqual([b.name]);
  });

  it("بر اساس وضعیت فیلتر می‌کند", async () => {
    await productRepository.create(makeInput({ quantity: 0, torobId: "z1" }));
    await productRepository.create(makeInput({ quantity: 4, torobId: "z2" }));
    const filter: ProductFilter = { q: "", category: "", availability: "available", sort: "newest" };
    const result = filterProducts(await productRepository.findAll(), filter);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(4);
  });

  it("بر اساس دسته‌بندی فیلتر می‌کند", async () => {
    await productRepository.create(makeInput({ torobId: "c1", category: "لوازم خانگی" }));
    await productRepository.create(makeInput({ torobId: "c2", category: "کالای دیجیتال" }));
    const filter: ProductFilter = { q: "", category: "کالای دیجیتال", availability: "all", sort: "newest" };
    const result = filterProducts(await productRepository.findAll(), filter);
    expect(result).toHaveLength(1);
  });

  it("بر اساس قیمت صعودی مرتب می‌کند", async () => {
    await productRepository.create(makeInput({ torobId: "p1", sellingPrice: 50000 }));
    await productRepository.create(makeInput({ torobId: "p2", sellingPrice: 1000 }));
    await productRepository.create(makeInput({ torobId: "p3", sellingPrice: 30000 }));
    const result = sortProducts(await productRepository.findAll(), "price-asc");
    expect(result.map((p) => p.sellingPrice)).toEqual([1000, 30000, 50000]);
  });

  it("بر اساس موجودی نزولی مرتب می‌کند", async () => {
    await productRepository.create(makeInput({ torobId: "q1", quantity: 2 }));
    await productRepository.create(makeInput({ torobId: "q2", quantity: 9 }));
    const result = sortProducts(await productRepository.findAll(), "qty-desc");
    expect(result[0]?.quantity).toBe(9);
  });

  it("محصولات بی‌قیمت در مرتب‌سازی قیمت آخر قرار می‌گیرند", async () => {
    const pricey = await productRepository.create(makeInput({ torobId: "s1", sellingPrice: 80000 }));
    const cheap = await productRepository.create(makeInput({ torobId: "s2", sellingPrice: 5000 }));
    const noPrice = await productRepository.create(makeInput({ torobId: "s3", sellingPrice: null, purchasePrice: null, torobPrice: null }));
    const asc = sortProducts(await productRepository.findAll(), "price-asc");
    expect(asc.map((p) => p.id)).toEqual([cheap.id, pricey.id, noPrice.id]);
    const desc = sortProducts(await productRepository.findAll(), "price-desc");
    expect(desc.map((p) => p.id)).toEqual([pricey.id, cheap.id, noPrice.id]);
  });
});