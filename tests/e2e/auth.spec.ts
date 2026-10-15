import { expect, test } from "@playwright/test";
import { fillField, tapToUrl } from "./helpers";

const EMAIL = `e2e-${Date.now()}@marketflow.dev`;
const PASSWORD = "Marketflow123!";

// Deliberately exercises the real form (not the session-mint login helper):
// this spec is the UI coverage. Dispatched clicks inside toPass retries ride
// out dev-mode navigation stalls — see helpers.ts.

test("register → login → admin guard redirects to login", async ({ page }) => {
  // Register creates the account and lands on the storefront home.
  await page.goto("/en/register");
  await fillField(page.getByLabel("Name"), "E2E User");
  await fillField(page.getByLabel("Email"), EMAIL);
  await fillField(page.getByLabel("Password"), PASSWORD);
  await tapToUrl(page.getByRole("button", { name: "Create account" }), /\/en$/, 90_000);
  await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();

  // Log out, then log back in with the new credentials.
  await tapToUrl(page.getByRole("link", { name: "Account" }), /\/en\/account/);
  await tapToUrl(page.getByRole("button", { name: "Sign out" }), /\/en\/login/, 90_000);

  await fillField(page.getByLabel("Email"), EMAIL);
  await fillField(page.getByLabel("Password"), PASSWORD);
  await tapToUrl(page.getByRole("button", { name: "Sign in" }), /\/en$/, 90_000);

  // A CUSTOMER actor must not reach /admin; the guard sends them to /login
  // (which then bounces an authenticated user home).
  const bouncedToLogin = page.waitForResponse((r) => r.url().includes("/login"));
  await page.goto("/en/admin");
  await bouncedToLogin;
  expect(page.url()).not.toContain("/admin");
});

test("seeded seller reaches the seller shell; customer is redirected", async ({ page }) => {
  // No session → seller shell redirects to login.
  await page.goto("/vi/seller");
  await page.waitForURL("**/vi/login**");

  // Seller session → shell renders in Vietnamese.
  await fillField(page.getByLabel("Email"), "seller@marketflow.dev");
  await fillField(page.getByLabel("Mật khẩu"), PASSWORD);
  await tapToUrl(page.getByRole("button", { name: "Đăng nhập" }), /\/vi$/, 90_000);
  await page.goto("/vi/seller");
  await expect(page.getByRole("heading", { name: "Kênh Người Bán" })).toBeVisible();
  await expect(page.getByText("Saigon Crafts")).toBeVisible();
});
