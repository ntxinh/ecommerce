import "server-only";
import type { DB } from "../client";
import {
  orderItems,
  orders,
  productAttributes,
  productImages,
  reviews,
  sellerOrders,
} from "../schema";
import { SEEDED_AT } from "./identity";

const PRODUCTS = ["prod_1", "prod_2", "prod_3", "prod_4", "prod_5", "prod_6", "prod_draft"];

/** 2 checked-in SVG placeholders per product (public/seed/) — hermetic for e2e. */
export function seedMedia(db: DB) {
  db.insert(productImages)
    .values(
      PRODUCTS.flatMap((productId) => [
        {
          id: `img_${productId}_1`,
          productId,
          url: `/seed/${productId}-1.svg`,
          alt: `${productId} photo 1`,
          sortOrder: 0,
        },
        {
          id: `img_${productId}_2`,
          productId,
          url: `/seed/${productId}-2.svg`,
          alt: `${productId} photo 2`,
          sortOrder: 1,
        },
      ]),
    )
    .onConflictDoNothing()
    .run();

  db.insert(productAttributes)
    .values([
      {
        id: "attr_1",
        productId: "prod_1",
        name: "Material",
        value: "Glazed stoneware",
        sortOrder: 0,
      },
      { id: "attr_2", productId: "prod_1", name: "Origin", value: "Bat Trang", sortOrder: 1 },
      { id: "attr_3", productId: "prod_3", name: "Material", value: "100% linen", sortOrder: 0 },
    ])
    .onConflictDoNothing()
    .run();
}

/**
 * Completed orders + reviews. order_items double as the "trending" signal and
 * as real FK parents for reviews (orderItemId stays nullable per schema note).
 */
export function seedReviews(db: DB) {
  db.insert(orders)
    .values([
      {
        id: "ord_1",
        userId: "usr_customer",
        addressSnapshotJson: '{"line1":"1 Nguyen Hue","city":"Ho Chi Minh City"}',
        status: "COMPLETED",
        totalVnd: 150000,
        subtotalVnd: 135000,
        shippingVnd: 15000,
        idempotencyKey: "seed-ord-1",
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: "ord_2",
        userId: "usr_customer",
        addressSnapshotJson: '{"line1":"1 Nguyen Hue","city":"Ho Chi Minh City"}',
        status: "COMPLETED",
        totalVnd: 420000,
        subtotalVnd: 390000,
        shippingVnd: 30000,
        idempotencyKey: "seed-ord-2",
        createdAt: SEEDED_AT + 1000,
        updatedAt: SEEDED_AT + 1000,
      },
      {
        id: "ord_3",
        userId: "usr_customer",
        addressSnapshotJson: '{"line1":"1 Nguyen Hue","city":"Ho Chi Minh City"}',
        status: "COMPLETED",
        totalVnd: 314000,
        subtotalVnd: 299000,
        shippingVnd: 15000,
        idempotencyKey: "seed-ord-3",
        createdAt: SEEDED_AT + 2000,
        updatedAt: SEEDED_AT + 2000,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(sellerOrders)
    .values([
      {
        id: "so_1",
        orderId: "ord_1",
        shopId: "shop_1",
        status: "COMPLETED",
        subtotalVnd: 135000,
        shippingVnd: 15000,
        commissionRateBps: 500,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: "so_2",
        orderId: "ord_2",
        shopId: "shop_1",
        status: "COMPLETED",
        subtotalVnd: 135000,
        shippingVnd: 15000,
        commissionRateBps: 500,
        createdAt: SEEDED_AT + 1000,
        updatedAt: SEEDED_AT + 1000,
      },
      {
        id: "so_3",
        orderId: "ord_2",
        shopId: "shop_2",
        status: "COMPLETED",
        subtotalVnd: 255000,
        shippingVnd: 15000,
        commissionRateBps: 500,
        createdAt: SEEDED_AT + 1000,
        updatedAt: SEEDED_AT + 1000,
      },
      {
        id: "so_4",
        orderId: "ord_3",
        shopId: "shop_1",
        status: "COMPLETED",
        subtotalVnd: 299000,
        shippingVnd: 15000,
        commissionRateBps: 500,
        createdAt: SEEDED_AT + 2000,
        updatedAt: SEEDED_AT + 2000,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(orderItems)
    .values([
      {
        id: "oi_1",
        sellerOrderId: "so_1",
        orderId: "ord_1",
        variantId: "var_1",
        productId: "prod_1",
        nameSnapshot: "Handmade Ceramic Mug",
        skuSnapshot: "MUG-BLU",
        attrsJson: '{"color":"blue"}',
        unitPriceVnd: 135000,
        qty: 1,
        lineTotalVnd: 135000,
      },
      {
        id: "oi_2",
        sellerOrderId: "so_2",
        orderId: "ord_2",
        variantId: "var_1",
        productId: "prod_1",
        nameSnapshot: "Handmade Ceramic Mug",
        skuSnapshot: "MUG-BLU",
        attrsJson: '{"color":"blue"}',
        unitPriceVnd: 135000,
        qty: 1,
        lineTotalVnd: 135000,
      },
      {
        id: "oi_3",
        sellerOrderId: "so_3",
        orderId: "ord_2",
        variantId: "var_6",
        productId: "prod_4",
        nameSnapshot: "Bamboo Basket",
        skuSnapshot: "BSK-MD",
        attrsJson: '{"size":"M"}',
        unitPriceVnd: 90000,
        qty: 2,
        lineTotalVnd: 180000,
      },
      {
        id: "oi_4",
        sellerOrderId: "so_3",
        orderId: "ord_2",
        variantId: "var_8",
        productId: "prod_6",
        nameSnapshot: "Straw Hat",
        skuSnapshot: "HAT-STD",
        attrsJson: '{"size":"std"}',
        unitPriceVnd: 75000,
        qty: 1,
        lineTotalVnd: 75000,
      },
      {
        id: "oi_5",
        sellerOrderId: "so_4",
        orderId: "ord_3",
        variantId: "var_4",
        productId: "prod_3",
        nameSnapshot: "Linen Shirt",
        skuSnapshot: "SHIRT-LIN-M",
        attrsJson: '{"size":"M"}',
        unitPriceVnd: 299000,
        qty: 1,
        lineTotalVnd: 299000,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(reviews)
    .values([
      {
        id: "rev_1",
        orderItemId: "oi_1",
        productId: "prod_1",
        userId: "usr_customer",
        rating: 5,
        title: "Beautiful glaze",
        body: "Better than expected.",
        createdAt: SEEDED_AT + 10000,
      },
      {
        id: "rev_2",
        orderItemId: "oi_2",
        productId: "prod_1",
        userId: "usr_customer",
        rating: 4,
        title: "Solid mug",
        createdAt: SEEDED_AT + 11000,
      },
      {
        id: "rev_3",
        orderItemId: "oi_3",
        productId: "prod_4",
        userId: "usr_customer",
        rating: 4,
        body: "Sturdy weave.",
        createdAt: SEEDED_AT + 12000,
      },
      {
        id: "rev_4",
        orderItemId: "oi_5",
        productId: "prod_3",
        userId: "usr_customer",
        rating: 3,
        createdAt: SEEDED_AT + 13000,
      },
      // Nullable orderItemId path: seeded rating not yet tied to a purchase.
      {
        id: "rev_5",
        productId: "prod_5",
        userId: "usr_admin",
        rating: 5,
        title: "Lovely scarf",
        createdAt: SEEDED_AT + 14000,
      },
      // Hidden moderation state — must not affect aggregates.
      {
        id: "rev_6",
        productId: "prod_6",
        userId: "usr_customer",
        rating: 1,
        body: "Arrived damaged.",
        status: "HIDDEN",
        createdAt: SEEDED_AT + 15000,
      },
    ])
    .onConflictDoNothing()
    .run();
}
