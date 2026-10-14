import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "Marketflow123!";
// Fresh customers per run: their own server-side carts, so this spec can't
// interleave lines with checkout.spec's seeded-customer tests. One address per
// test — Playwright may retry a failed test, and a taken email is not idempotent.
const SELLER = "seller@marketflow.dev"; // shop_1 (Saigon Crafts) owner
const customerEmail = () => `e2e-fulfillment-${Date.now()}@marketflow.dev`;

// Serial: the whole journey is one order's lifecycle — customer places, seller
// fulfills, customer verifies — so each leg depends on the previous.
test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/en");
}

async function signOut(page: Page) {
  await page.goto("/en/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/en/login");
}

async function addToCart(page: Page, slug: string) {
  await page.goto(`/en/products/${slug}`);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
}

/**
 * Checkout for a registered user. `newAddress` fills the inline address form
 * (users without a saved address); `simulate` drives the mock providers.
 * Returns the order id from the confirmation redirect.
 */
async function checkout(
  page: Page,
  payment: RegExp,
  opts: { simulate?: string; newAddress?: boolean } = {},
) {
  await page.goto("/en/cart");
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await page.waitForURL("**/en/checkout");
  if (opts.newAddress) {
    await page.getByRole("radio", { name: "Use a new address" }).check();
    await page.getByLabel("Recipient name").fill("E2E Buyer");
    await page.getByLabel("Phone").fill("0912345678");
    await page.getByLabel("Address line").fill("9 Hai Ba Trung");
    await page.getByLabel("Ward").fill("Ben Nghe");
    await page.getByLabel("District").fill("District 1");
    await page.getByLabel("City").fill("Ho Chi Minh City");
  }
  await page.getByRole("button", { name: /Payment/ }).click();
  await page.getByRole("radio", { name: payment }).check();
  if (opts.simulate) await page.getByLabel("Simulate payment result").selectOption(opts.simulate);
  await page.getByRole("button", { name: /Review/ }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL("**/en/checkout/confirmation?order=**");
  return new URL(page.url()).searchParams.get("order") as string;
}

async function registerCustomer(page: Page, email: string) {
  await page.goto("/en/register");
  await page.getByLabel("Name").fill("E2E Buyer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/en");
}

test("COD order: seller confirm → pack → ship w/ tracking → deliver; customer sees the timeline", async ({
  page,
}) => {
  const customer = customerEmail();
  await registerCustomer(page, customer);

  // handmade-ceramic-mug is shop_1 only → one seller order.
  await addToCart(page, "handmade-ceramic-mug");
  const orderId = await checkout(page, /Cash on delivery/, { newAddress: true });
  await page.goto(`/en/account/orders/${orderId}`);

  const legCard = page.locator("section > div", {
    has: page.getByText(/Seller order so_/),
  });
  const sellerOrderId = (
    await legCard
      .getByText(/Seller order so_/)
      .first()
      .innerText()
  ).replace("Seller order ", "");
  expect(sellerOrderId).toMatch(/^so_/);
  // COD: the parent is ready to fulfill, the leg starts NEW.
  await expect(legCard.getByText("New")).toBeVisible();

  await signOut(page);
  await login(page, SELLER);
  await page.goto(`/en/seller/orders/${sellerOrderId}`);

  // NEW → CONFIRMED → PACKING → (ship form) → SHIPPED → DELIVERED. Each click
  // runs a server action + router.refresh(); the badge flips in place.
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("heading").getByText("Confirmed")).toBeVisible();

  await page.getByRole("button", { name: "Pack" }).click();
  await expect(page.getByRole("heading").getByText("Packing")).toBeVisible();

  const tracking = `E2E-${Date.now()}`;
  await page.getByLabel("Carrier").fill("ghn");
  await page.getByLabel("Tracking number").fill(tracking);
  await page.getByRole("button", { name: "Ship", exact: true }).click();
  await expect(page.getByRole("heading").getByText("Shipped")).toBeVisible();
  // Shipment card: provider, tracking number, shipment status + SHIPPED event.
  await expect(page.getByText(`ghn — ${tracking}`)).toBeVisible();
  await expect(page.getByText("IN_TRANSIT")).toBeVisible();
  await expect(page.locator("ol").getByText("SHIPPED")).toBeVisible();

  await page.getByRole("button", { name: "Deliver" }).click();
  await expect(page.getByRole("heading").getByText("Delivered")).toBeVisible();
  await expect(page.locator("ol").getByText("DELIVERED")).toBeVisible(); // timeline event

  await signOut(page);
  await login(page, customer);
  await page.goto(`/en/account/orders/${orderId}`);
  // Customer's timeline mirrors the shipment: provider/tracking + both events.
  await expect(page.getByText(`Shipment: ghn — ${tracking}`)).toBeVisible();
  await expect(page.locator("ol").getByText("SHIPPED")).toBeVisible();
  await expect(page.locator("ol").getByText("DELIVERED")).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
});

test("MOCK_BANK simulate=failure leaves the order PAYMENT_FAILED", async ({ page }) => {
  await registerCustomer(page, customerEmail());
  await addToCart(page, "handmade-ceramic-mug");

  const orderId = await checkout(page, /Bank transfer/, {
    simulate: "failure",
    newAddress: true,
  });
  // Mock dispatch is synchronous — the confirmation already shows the outcome.
  await expect(page.getByText("PAYMENT_FAILED")).toBeVisible();

  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByText("PAYMENT_FAILED")).toBeVisible();
  await expect(page.getByText("MOCK_BANK — FAILED")).toBeVisible();
});

test("stripe is hidden without keys and the webhook 404s without its secret", async ({
  page,
  request,
}) => {
  // playwright.config strips STRIPE_* for the web server — the picker must
  // not offer Stripe and the webhook sink must not answer.
  await registerCustomer(page, customerEmail());
  await addToCart(page, "handmade-ceramic-mug");
  await page.goto("/en/cart");
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await page.getByRole("button", { name: /Payment/ }).click();
  await expect(page.locator('input[name="paymentMethod"][value="STRIPE"]')).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Bank transfer/ })).toBeVisible();

  const res = await request.post("/api/v1/webhooks/stripe", {
    data: { type: "checkout.session.completed" },
  });
  expect(res.status()).toBe(404);
});
