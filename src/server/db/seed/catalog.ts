import "server-only";
import type { DB } from "../client";
import {
  brands,
  categories,
  inventory,
  products,
  productVariants,
  promotions,
  sellerApplications,
  shopMemberships,
  shops,
  userRoles,
  vouchers,
} from "../schema";
import { SEEDED_AT } from "./identity";
import { seedMedia, seedReviews } from "./media";

// Deterministic promo/voucher window: active through 2030.
const PROMO_END = SEEDED_AT + 5 * 365 * 24 * 60 * 60 * 1000;

// usr_seller2 keeps its PENDING app_1 fixture and gains an APPROVED app_2 that
// grants SELLER role + ownership of shop_2 "Danang Goods".
export function seedCatalog(db: DB) {
  db.insert(shops)
    .values({
      id: "shop_2",
      slug: "danang-goods",
      name: "Danang Goods",
      description: "Second demo seller shop",
      createdAt: SEEDED_AT,
    })
    .onConflictDoNothing()
    .run();

  db.insert(shopMemberships)
    .values({ shopId: "shop_2", userId: "usr_seller2", role: "OWNER" })
    .onConflictDoNothing()
    .run();

  db.insert(userRoles)
    .values({ userId: "usr_seller2", role: "SELLER" })
    .onConflictDoNothing()
    .run();

  db.insert(sellerApplications)
    .values({
      id: "app_2",
      userId: "usr_seller2",
      shopName: "Danang Goods",
      status: "APPROVED",
      decidedBy: "usr_admin",
      decidedAt: SEEDED_AT,
      createdAt: SEEDED_AT,
    })
    .onConflictDoNothing()
    .run();

  db.insert(categories)
    .values([
      {
        id: "cat_1",
        slug: "handicrafts",
        nameEn: "Handicrafts",
        nameVi: "Thủ công mỹ nghệ",
        sortOrder: 1,
      },
      { id: "cat_2", slug: "fashion", nameEn: "Fashion", nameVi: "Thời trang", sortOrder: 2 },
      {
        id: "cat_3",
        parentId: "cat_1",
        slug: "ceramics",
        nameEn: "Ceramics",
        nameVi: "Gốm sứ",
        sortOrder: 1,
      },
      {
        id: "cat_4",
        parentId: "cat_2",
        slug: "apparel",
        nameEn: "Apparel",
        nameVi: "May mặc",
        sortOrder: 1,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(brands).values({ id: "brand_1", name: "Saigon Artisans" }).onConflictDoNothing().run();

  db.insert(products)
    .values([
      {
        id: "prod_1",
        shopId: "shop_1",
        categoryId: "cat_3",
        brandId: "brand_1",
        slug: "handmade-ceramic-mug",
        nameEn: "Handmade Ceramic Mug",
        nameVi: "Cốc gốm thủ công",
        descriptionEn: "Glazed stoneware mug, 350ml.",
        descriptionVi: "Cốc đá men rạn, 350ml.",
        status: "ACTIVE",
        createdAt: SEEDED_AT,
      },
      {
        id: "prod_2",
        shopId: "shop_1",
        categoryId: "cat_3",
        brandId: "brand_1",
        slug: "ceramic-teapot",
        nameEn: "Ceramic Teapot",
        nameVi: "Ấm trà gốm",
        descriptionEn: "Classic teapot, 800ml.",
        descriptionVi: "Ấm trà cổ điển, 800ml.",
        status: "ACTIVE",
        createdAt: SEEDED_AT + 1000,
      },
      {
        id: "prod_3",
        shopId: "shop_1",
        categoryId: "cat_4",
        slug: "linen-shirt",
        nameEn: "Linen Shirt",
        nameVi: "Áo sơ mi linen",
        descriptionEn: "Breathable linen shirt.",
        descriptionVi: "Áo linen thoáng mát.",
        status: "ACTIVE",
        createdAt: SEEDED_AT + 2000,
      },
      {
        id: "prod_4",
        shopId: "shop_2",
        categoryId: "cat_1",
        slug: "bamboo-basket",
        nameEn: "Bamboo Basket",
        nameVi: "Giỏ tre",
        descriptionEn: "Hand-woven bamboo basket.",
        descriptionVi: "Giỏ tre đan thủ công.",
        status: "ACTIVE",
        createdAt: SEEDED_AT + 3000,
      },
      {
        id: "prod_5",
        shopId: "shop_2",
        categoryId: "cat_4",
        slug: "cotton-scarf",
        nameEn: "Cotton Scarf",
        nameVi: "Khăn cotton",
        descriptionEn: "Soft woven cotton scarf.",
        descriptionVi: "Khăn cotton dệt mềm.",
        status: "ACTIVE",
        createdAt: SEEDED_AT + 4000,
      },
      {
        id: "prod_6",
        shopId: "shop_2",
        categoryId: "cat_4",
        slug: "straw-hat",
        nameEn: "Straw Hat",
        nameVi: "Nón rơm",
        descriptionEn: "Classic straw hat.",
        descriptionVi: "Nón rơm truyền thống.",
        status: "ACTIVE",
        createdAt: SEEDED_AT + 5000,
      },
      {
        // DRAFT — exists so public listings prove non-ACTIVE exclusion.
        id: "prod_draft",
        shopId: "shop_1",
        categoryId: "cat_1",
        slug: "unlisted-vase",
        nameEn: "Unlisted Vase",
        nameVi: "Bình chưa niêm yết",
        status: "DRAFT",
        createdAt: SEEDED_AT + 6000,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(productVariants)
    .values([
      {
        id: "var_1",
        productId: "prod_1",
        sku: "MUG-BLU",
        nameEn: "Blue",
        nameVi: "Xanh dương",
        attributesJson: '{"color":"blue"}',
        basePriceVnd: 150000,
        salePriceVnd: 135000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_2",
        productId: "prod_1",
        sku: "MUG-GRN",
        nameEn: "Green",
        nameVi: "Xanh lá",
        attributesJson: '{"color":"green"}',
        basePriceVnd: 150000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_3",
        productId: "prod_2",
        sku: "TEA-800",
        nameEn: "800ml",
        nameVi: "800ml",
        attributesJson: '{"size":"800ml"}',
        basePriceVnd: 420000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_4",
        productId: "prod_3",
        sku: "SHIRT-LIN-M",
        nameEn: "Size M",
        nameVi: "Size M",
        attributesJson: '{"size":"M"}',
        basePriceVnd: 350000,
        salePriceVnd: 299000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_5",
        productId: "prod_3",
        sku: "SHIRT-LIN-L",
        nameEn: "Size L",
        nameVi: "Size L",
        attributesJson: '{"size":"L"}',
        basePriceVnd: 350000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_6",
        productId: "prod_4",
        sku: "BSK-MD",
        nameEn: "Medium",
        nameVi: "Vừa",
        attributesJson: '{"size":"M"}',
        basePriceVnd: 90000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_7",
        productId: "prod_5",
        sku: "SCF-NAT",
        nameEn: "Natural",
        nameVi: "Tự nhiên",
        attributesJson: '{"color":"natural"}',
        basePriceVnd: 120000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_8",
        productId: "prod_6",
        sku: "HAT-STD",
        nameEn: "Standard",
        nameVi: "Chuẩn",
        attributesJson: '{"size":"std"}',
        basePriceVnd: 75000,
        createdAt: SEEDED_AT,
      },
      {
        id: "var_draft",
        productId: "prod_draft",
        sku: "VASE-SM",
        nameEn: "Small",
        nameVi: "Nhỏ",
        attributesJson: '{"size":"S"}',
        basePriceVnd: 200000,
        createdAt: SEEDED_AT,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(inventory)
    .values(
      ["var_1", "var_2", "var_3", "var_4", "var_5", "var_6", "var_7", "var_8", "var_draft"].map(
        (variantId, i) => ({
          variantId,
          onHand: 20 + i * 5,
          reserved: 0,
          updatedAt: SEEDED_AT,
        }),
      ),
    )
    .onConflictDoNothing()
    .run();

  db.insert(vouchers)
    .values([
      {
        id: "vch_1",
        code: "WELCOME10",
        scope: "PLATFORM",
        kind: "PERCENT",
        value: 1000, // 10% in bps
        maxDiscountVnd: 50000,
        startsAt: SEEDED_AT,
        endsAt: PROMO_END,
        perUserLimit: 1,
      },
      {
        id: "vch_2",
        code: "SHOP2FIX",
        scope: "SHOP",
        shopId: "shop_2",
        kind: "FIXED",
        value: 20000,
        minSpendVnd: 200000,
        startsAt: SEEDED_AT,
        endsAt: PROMO_END,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(promotions)
    .values([
      {
        id: "prm_1",
        scope: "SHOP",
        shopId: "shop_1",
        kind: "PERCENT",
        value: 500, // 5% in bps
        startsAt: SEEDED_AT,
        endsAt: PROMO_END,
      },
      {
        id: "prm_2",
        scope: "FLASH",
        productId: "prod_1",
        kind: "FLASH_PRICE",
        value: 99000,
        startsAt: SEEDED_AT,
        endsAt: PROMO_END,
      },
    ])
    .onConflictDoNothing()
    .run();

  seedMedia(db);
  seedReviews(db);
}
