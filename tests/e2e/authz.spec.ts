import { expect, test } from "@playwright/test";
import {
  addToCart,
  checkout,
  login,
  registerCustomer,
  SELLER,
  SELLER2,
  sellerOrderIds,
  signOut,
} from "./helpers";

const email = () => `e2e-authz-${Date.now()}@marketflow.dev`;

test("cross-shop denial: seller B's read of seller A's order/product 404s; cancel works on own leg", async ({
  page,
}) => {
  // --- customer places a shop_1 order (Saigon Crafts) ---
  await registerCustomer(page, email());
  await addToCart(page, "handmade-ceramic-mug");
  const orderId = await checkout(page);
  const [legId] = await sellerOrderIds(page, orderId);
  expect(legId).toMatch(/^so_/);
  await signOut(page);

  // --- seller B (Danang Goods) cannot read seller A's seller-order or product ---
  await login(page, SELLER2);
  const res = await page.goto(`/en/seller/orders/${legId}`);
  expect(res?.status()).toBe(404);
  // Cross-shop product edit renders the same 404 surface.
  const res2 = await page.goto("/en/seller/products/prod_1");
  expect(res2?.status()).toBe(404);
  await signOut(page);

  // --- seller A can read the leg and cancel it (NEW → CANCELLED) ---
  await login(page, SELLER);
  await page.goto(`/en/seller/orders/${legId}`);
  await expect(page.getByRole("heading", { name: new RegExp(legId) })).toBeVisible();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByRole("heading").getByText("Cancelled")).toBeVisible();
  // The parent order badge on this page reflects the cancelled leg.
  await expect(page.getByText("CANCELLED").first()).toBeVisible();
});
