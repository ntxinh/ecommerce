import { expect, test } from "@playwright/test";

const EMAIL = `e2e-${Date.now()}@marketflow.dev`;
const PASSWORD = "Marketflow123!";

test("register → login → admin guard redirects to login", async ({ page }) => {
  // Register creates the account and lands on the storefront home.
  await page.goto("/en/register");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/en");
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();

  // Log out, then log back in with the new credentials.
  await page.getByRole("link", { name: "Account" }).click();
  await page.waitForURL("**/en/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/en/login");

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/en");

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
  await page.getByLabel("Email").fill("seller@marketflow.dev");
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL("**/vi");
  await page.goto("/vi/seller");
  await expect(page.getByRole("heading", { name: "Kênh Người Bán" })).toBeVisible();
  await expect(page.getByText("Saigon Crafts")).toBeVisible();
});
