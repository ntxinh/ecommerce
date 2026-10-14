import "server-only";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { shops } from "./sellers";

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameVi: text("name_vi").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_slug_unique").on(t.slug)],
);

export const brands = sqliteTable(
  "brands",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("brands_name_unique").on(t.name)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    brandId: text("brand_id").references(() => brands.id),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameVi: text("name_vi").notNull(),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionVi: text("description_vi").notNull().default(""),
    status: text("status", { enum: ["DRAFT", "ACTIVE", "ARCHIVED"] })
      .notNull()
      .default("DRAFT"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("products_slug_unique").on(t.slug),
    index("products_shop_idx").on(t.shopId),
    index("products_category_idx").on(t.categoryId),
  ],
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    nameEn: text("name_en").notNull(),
    nameVi: text("name_vi").notNull(),
    attributesJson: text("attributes_json").notNull().default("{}"),
    basePriceVnd: integer("base_price_vnd").notNull(),
    salePriceVnd: integer("sale_price_vnd"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("product_variants_sku_unique").on(t.sku),
    index("product_variants_product_idx").on(t.productId),
    index("product_variants_sku_idx").on(t.sku),
  ],
);
