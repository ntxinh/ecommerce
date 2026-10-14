import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "Marketflow123!";
// Fresh customers per run — same rationale as fulfillment.spec.ts: their own
// carts, and a taken email breaks a Playwright retry.
const SELLER = "seller@marketflow.dev"; // shop_1 (Saigon Crafts) owner
const ADMIN = "admin@marketflow.dev";
const customerEmail = () => `e2e-returns-${Date.now()}@marketflow.dev`;

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

async function checkout(page: Page, payment: RegExp) {
  await page.goto("/en/cart");
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await page.waitForURL("**/en/checkout");
  await page.getByRole("radio", { name: "Use a new address" }).check();
  await page.getByLabel("Recipient name").fill("E2E Buyer");
  await page.getByLabel("Phone").fill("0912345678");
  await page.getByLabel("Address line").fill("9 Hai Ba Trung");
  await page.getByLabel("Ward").fill("Ben Nghe");
  await page.getByLabel("District").fill("District 1");
  await page.getByLabel("City").fill("Ho Chi Minh City");
  await page.getByRole("button", { name: /Payment/ }).click();
  await page.getByRole("radio", { name: payment }).check();
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

test("COD return: customer request → seller approve → refund settles, leg RETURNED; admin queue shows the completed refund", async ({
  page,
}) => {
  const customer = customerEmail();
  await registerCustomer(page, customer);

  // handmade-ceramic-mug is shop_1 only → one seller order.
  await addToCart(page, "handmade-ceramic-mug");
  const orderId = await checkout(page, /Cash on delivery/);
  await page.goto(`/en/account/orders/${orderId}`);
  const sellerOrderId = (
    await page
      .getByText(/Seller order so_/)
      .first()
      .innerText()
  ).replace("Seller order ", "");
  expect(sellerOrderId).toMatch(/^so_/);

  // Seller drives the leg to DELIVERED.
  await signOut(page);
  await login(page, SELLER);
  await page.goto(`/en/seller/orders/${sellerOrderId}`);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("heading").getByText("Confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Pack" }).click();
  await expect(page.getByRole("heading").getByText("Packing")).toBeVisible();
  await page.getByLabel("Carrier").fill("ghn");
  await page.getByLabel("Tracking number").fill(`E2E-R-${Date.now()}`);
  await page.getByRole("button", { name: "Ship", exact: true }).click();
  await expect(page.getByRole("heading").getByText("Shipped")).toBeVisible();
  await page.getByRole("button", { name: "Deliver" }).click();
  await expect(page.getByRole("heading").getByText("Delivered")).toBeVisible();

  // Customer requests a return on the delivered leg.
  await signOut(page);
  await login(page, customer);
  await page.goto(`/en/account/orders/${orderId}`);
  await page.locator('input[name^="qty-"]').fill("1");
  await page.locator('input[name^="restock-"]').check();
  await page.locator('input[name="reason"]').fill("Arrived with a crack");
  await page.getByRole("button", { name: "Submit return request" }).click();
  // DELIVERED leg flips to RETURN_REQUESTED; the request shows as PENDING.
  await expect(page.getByText("Return requested").first()).toBeVisible();
  await expect(page.getByText("Pending").first()).toBeVisible();

  // Seller approves in the returns queue.
  await signOut(page);
  await login(page, SELLER);
  await page.goto("/en/seller/returns");
  await expect(page.getByText(/rr_/).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  // PENDING view empties; the request is now REFUNDED under All.
  await expect(page.getByText("No return requests.")).toBeVisible();
  await page.goto("/en/seller/returns?status=ALL");
  await expect(page.getByText("Refunded").first()).toBeVisible();

  // COD: nothing was captured, so the refund settles as a zero-amount
  // COMPLETED marker — visible in the admin refund queue.
  await signOut(page);
  await login(page, ADMIN);
  await page.goto("/en/admin/refunds");
  await expect(page.getByRole("heading", { name: "Refunds" })).toBeVisible();
  await expect(page.getByText("return_settled_no_payment").first()).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();

  // Customer sees the leg RETURNED and the request REFUNDED.
  await signOut(page);
  await login(page, customer);
  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByText("Returned", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Refunded").first()).toBeVisible();
});
