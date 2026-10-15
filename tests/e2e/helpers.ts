import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import { E2E_DB } from "../../playwright.config";

export const PASSWORD = "Marketflow123!";
export const ADMIN = "admin@marketflow.dev";
export const SELLER = "seller@marketflow.dev"; // shop_1 (Saigon Crafts) owner
export const SELLER2 = "seller2@marketflow.dev"; // shop_2 (Danang Goods) owner

const DB_PATH = E2E_DB.replace("file:", "");

/* Dev-server turbulence: Turbopack keeps an in-flight "navigation" alive
 * (Fast Refresh reloads on cold compile, watched-file churn), and every
 * trusted interaction (.click/.check/.fill/.selectOption) stalls in
 * Playwright's "waiting for navigation to finish" actionability step. The
 * helpers below dispatch untrusted events — real React/DOM handlers still
 * fire — inside expect().toPass retries, which also ride out pre-hydration
 * no-ops on controlled inputs and Fast-Refresh DOM detaches. */

/** Dispatch click + assert until, retried. `until` runs inside the retry. */
export async function tap(locator: Locator, until?: () => Promise<void>, timeout = 60_000) {
  await expect(async () => {
    await locator.dispatchEvent("click");
    if (until) await until();
  }).toPass({ timeout });
}

/** Radio/checkbox: dispatch click (label wrapper flips the input), assert
 *  checked inside the retry so a swallowed click just retries. */
export async function checkRadio(locator: Locator, timeout = 60_000) {
  await tap(locator, () => expect(locator).toBeChecked({ timeout: 3_000 }), timeout);
}

/** Fill a text input, asserting the value — controlled inputs swallow fills
 *  before hydration. */
export async function fillField(locator: Locator, value: string, timeout = 60_000) {
  await expect(async () => {
    await locator.fill(value);
    await expect(locator).toHaveValue(value, { timeout: 3_000 });
  }).toPass({ timeout });
}

/** Select an option on a controlled <select>, asserting the value or the
 *  selected option's label. */
export async function selectOption(
  locator: Locator,
  value: string | { label: string },
  timeout = 60_000,
) {
  const want = typeof value === "string" ? value : value.label;
  await expect(async () => {
    await locator.selectOption(value);
    const applied = await locator.evaluate(
      (el: Element, want: string) =>
        el instanceof HTMLSelectElement &&
        el.selectedOptions.length > 0 &&
        (el.value === want || el.selectedOptions[0].textContent === want),
      want,
    );
    expect(applied).toBe(true);
  }).toPass({ timeout });
}

/** Dispatch click, then retry-wait for a URL (client-side SPA navigations). */
export async function tapToUrl(locator: Locator, url: string | RegExp, timeout = 60_000) {
  await tap(locator, () => expect(locator.page()).toHaveURL(url, { timeout: 15_000 }), timeout);
}

/** Non-retrying submit for create-type <form action={serverAction}> posts:
 *  dispatch once (a native pre-hydration submit still runs the action), then
 *  poll the URL. Retrying the click here could double-submit — unlike
 *  tapToUrl, which only suits repeatable client navigations. */
export async function submitForUrl(locator: Locator, url: string | RegExp, timeout = 90_000) {
  await locator.dispatchEvent("click");
  await expect(locator.page()).toHaveURL(url, { timeout });
}

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
  // Actor-gated marker (the header renders the bell only for a signed-in
  // user); the Account icon is unconditional, so it can't prove the session.
  await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.context().clearCookies();
}

/** Register through the storefront form — lands on /en already signed in. */
export async function registerCustomer(page: Page, email: string) {
  await page.goto("/en/register");
  await page.waitForLoadState("domcontentloaded");
  await fillField(page.getByLabel("Name"), "E2E User");
  await fillField(page.getByLabel("Email"), email);
  await fillField(page.getByLabel("Password"), PASSWORD);
  // Registration creates the account server-side; only the URL is retried,
  // not the submit — a timed-out create then a successful one in the same
  // retry loop would land on the login page, not /en.
  await tapToUrl(page.getByRole("button", { name: "Create account" }), /\/en$/, 90_000);
}

export async function addToCart(page: Page, slug: string, qty = 1) {
  await page.goto(`/en/products/${slug}`);
  if (qty > 1) await fillField(page.getByLabel("Qty"), String(qty));
  await tap(page.getByRole("button", { name: "Add to cart" }), () =>
    expect(page.getByText("Added to cart")).toBeVisible({ timeout: 5_000 }),
  );
}

/**
 * COD checkout for a registered user (fresh address inline). Returns the
 * order id from the confirmation redirect. `voucherCodes` fills the payment
 * step's voucher field verbatim.
 */
export async function checkout(page: Page, opts: { voucherCodes?: string } = {}) {
  await page.goto("/en/cart");
  await tapToUrl(page.getByRole("link", { name: "Proceed to checkout" }), /\/en\/checkout/);
  await checkRadio(page.getByRole("radio", { name: "Use a new address" }));
  await fillField(page.getByLabel("Recipient name"), "E2E Buyer");
  await fillField(page.getByLabel("Phone"), "0912345678");
  await fillField(page.getByLabel("Address line"), "9 Hai Ba Trung");
  await fillField(page.getByLabel("Ward"), "Ben Nghe");
  await fillField(page.getByLabel("District"), "District 1");
  await fillField(page.getByLabel("City"), "Ho Chi Minh City");
  // Step nav is client state (Zustand): assert the next step's content
  // appears rather than trusting the button press.
  await tap(page.getByRole("button", { name: /Payment/ }), () =>
    expect(page.getByRole("radio", { name: /Cash on delivery/ })).toBeVisible({
      timeout: 5_000,
    }),
  );
  if (opts.voucherCodes) await fillField(page.getByLabel("Voucher codes"), opts.voucherCodes);
  await checkRadio(page.getByRole("radio", { name: /Cash on delivery/ }));
  await tap(page.getByRole("button", { name: /Review/ }), () =>
    expect(page.getByRole("button", { name: "Place order" })).toBeVisible({ timeout: 5_000 }),
  );
  await tapToUrl(
    page.getByRole("button", { name: "Place order" }),
    /\/en\/checkout\/confirmation\?order=/,
    90_000,
  );
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
