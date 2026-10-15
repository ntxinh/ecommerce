import { expect, test } from "@playwright/test";
import { addToCart, checkout, registerCustomer } from "./helpers";

const email = () => `e2e-voucher-${Date.now()}@marketflow.dev`;

test("SHOP2FIX applies a ₫20,000 shop discount when the shop leg meets min spend", async ({
  page,
}) => {
  // Fresh customer per run: voucher redemptions carry perUserLimit.
  await registerCustomer(page, email());
  // 2 × ₫120,000 (cotton-scarf, shop_2) ≥ SHOP2FIX's ₫200,000 min spend.
  await addToCart(page, "cotton-scarf", 2);

  const orderId = await checkout(page, { voucherCodes: "SHOP2FIX" });
  expect(orderId).toBeTruthy();

  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByText("Discount")).toBeVisible();
  await expect(page.getByText("-₫20,000")).toBeVisible();
  // Grand total = 2×120,000 merch + 15,000 shipping − 20,000 voucher. The
  // amount also shows as leg total/payment — assert inside the bold Total row.
  await expect(page.locator("div.flex.justify-between.font-medium").first()).toContainText(
    "₫235,000",
  );
});

test("unknown voucher codes are ignored — order prices full, no discount row", async ({ page }) => {
  await registerCustomer(page, email());
  await addToCart(page, "bamboo-basket"); // ₫90,000

  const orderId = await checkout(page, { voucherCodes: "NOPE-INVALID-42" });
  expect(orderId).toBeTruthy();

  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByText("Discount")).toBeHidden();
  // Grand total = 90,000 merch + 15,000 shipping.
  await expect(page.locator("div.flex.justify-between.font-medium").first()).toContainText(
    "₫105,000",
  );
});
