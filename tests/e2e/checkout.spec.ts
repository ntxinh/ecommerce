import { expect, type Page, test } from "@playwright/test";

const EMAIL = "customer@marketflow.dev";
const PASSWORD = "Marketflow123!";

// Both tests run against the seeded customer's one server-side cart — serial
// keeps their add/checkout flows from interleaving lines.
test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/en");
}

async function addToCart(page: Page, slug: string) {
  await page.goto(`/en/products/${slug}`);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
}

/** Address is preselected (seeded addr_1) — step through to Payment to pick
 *  the method, then on to Review to submit. */
async function checkout(page: Page, payment: RegExp, simulate?: string) {
  await page.goto("/en/cart");
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await page.waitForURL("**/en/checkout");
  await page.getByRole("button", { name: /Payment/ }).click();
  await page.getByRole("radio", { name: payment }).check();
  if (simulate) await page.getByLabel("Simulate payment result").selectOption(simulate);
  await page.getByRole("button", { name: /Review/ }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL("**/en/checkout/confirmation?order=**");
  return new URL(page.url()).searchParams.get("order") as string;
}

test("multi-shop COD checkout: cart → stepper → confirmation → order detail", async ({ page }) => {
  await login(page);

  // prod_2 in shop_1 (Saigon Crafts) + prod_4 in shop_2 (Danang Goods).
  await addToCart(page, "ceramic-teapot");
  await addToCart(page, "bamboo-basket");

  await page.goto("/en/cart");
  await expect(page.getByText("Saigon Crafts")).toBeVisible();
  await expect(page.getByText("Danang Goods")).toBeVisible();

  const orderId = await checkout(page, /Cash on delivery/);
  expect(orderId).toBeTruthy();

  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
  // One seller order per shop.
  await expect(page.locator("section ul").getByRole("listitem")).toHaveCount(2);

  // h1 holds the status badge inside it — regex, not exact name.
  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByRole("heading", { name: `Order ${orderId}` })).toBeVisible();
  await expect(page.getByText("PROCESSING")).toBeVisible(); // COD → ready to fulfill
  await expect(page.getByText(/Ceramic Teapot/)).toBeVisible();
  await expect(page.getByText(/Bamboo Basket/)).toBeVisible();
  // Payment card shows the COD attempt stays PENDING until delivery.
  await expect(page.getByText("COD — PENDING")).toBeVisible();
});

test("mock wallet simulate=failure leaves the order PAYMENT_FAILED", async ({ page }) => {
  await login(page);
  await addToCart(page, "cotton-scarf"); // shop_2 — seller orders stay scoped

  const orderId = await checkout(page, /Mock wallet/, "failure");
  expect(orderId).toBeTruthy();

  // Wallet dispatch is synchronous: confirmation and detail both show the
  // failed state the commit settled on.
  await expect(page.getByText("PAYMENT_FAILED")).toBeVisible();

  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByRole("heading", { name: `Order ${orderId}` })).toBeVisible();
  await expect(page.getByText("PAYMENT_FAILED")).toBeVisible();
  await expect(page.getByText("MOCK_WALLET — FAILED")).toBeVisible();
});
