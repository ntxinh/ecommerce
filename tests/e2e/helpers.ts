import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { E2E_DB } from "../../playwright.config";

export const PASSWORD = "Marketflow123!";
export const ADMIN = "admin@marketflow.dev";
export const SELLER = "seller@marketflow.dev"; // shop_1 (Saigon Crafts) owner
export const SELLER2 = "seller2@marketflow.dev"; // shop_2 (Danang Goods) owner

const DB_PATH = E2E_DB.replace("file:", "");

/**
 * Sign in as an existing user. The login form is rate-limited (5/min per
 * account — features/auth/actions.ts) and multi-role journeys legitimately
 * exceed that across a run, so mint a session row directly instead. The form
 * itself is covered by auth.spec; these specs exercise post-login behaviour.
 */
export async function login(page: Page, email: string) {
  const token = execFileSync("node", ["tests/e2e/mint-session.mjs", DB_PATH, email])
    .toString()
    .trim();
  await page
    .context()
    .addCookies([{ name: "marketflow_session", value: token, domain: "localhost", path: "/" }]);
  await page.goto("/en");
  // Signed-in marker the anonymous shell lacks.
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.context().clearCookies();
}

/** Register through the storefront form — lands on /en already signed in. */
export async function registerCustomer(page: Page, email: string) {
  await page.goto("/en/register");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/en");
}

export async function addToCart(page: Page, slug: string, qty = 1) {
  await page.goto(`/en/products/${slug}`);
  if (qty > 1) await page.getByLabel("Qty").fill(String(qty));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
}

/**
 * COD checkout for a registered user (fresh address inline). Returns the
 * order id from the confirmation redirect. `voucherCodes` fills the payment
 * step's voucher field verbatim.
 */
export async function checkout(page: Page, opts: { voucherCodes?: string } = {}) {
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
  if (opts.voucherCodes) await page.getByLabel("Voucher codes").fill(opts.voucherCodes);
  await page.getByRole("radio", { name: /Cash on delivery/ }).check();
  await page.getByRole("button", { name: /Review/ }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL("**/en/checkout/confirmation?order=**");
  return new URL(page.url()).searchParams.get("order") as string;
}

/**
 * The seller-order ids of an order as shown on the customer's order detail
 * ("Seller order so_…" per leg card).
 */
export async function sellerOrderIds(page: Page, orderId: string): Promise<string[]> {
  await page.goto(`/en/account/orders/${orderId}`);
  const labels = await page.getByText(/Seller order so_/).allInnerTexts();
  return labels.map((l) => l.replace("Seller order ", "").trim());
}
