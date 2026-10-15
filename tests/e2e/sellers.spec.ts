import { expect, test } from "@playwright/test";
import { ADMIN, login, registerCustomer, SELLER, signOut } from "./helpers";

const email = () => `e2e-seller-${Date.now()}@marketflow.dev`;

test("register → apply to sell → admin approves → shop provisioned; /seller is gated before approval", async ({
  page,
}) => {
  const applicant = email();
  const shopName = `E2E Shop ${Date.now()}`;

  // --- applicant: register, then submit a seller application ---
  await registerCustomer(page, applicant);
  // Not a seller yet: the seller shell bounces a CUSTOMER actor back home.
  await page.goto("/en/seller");
  await page.waitForURL("**/en");

  await page.goto("/en/sell");
  await expect(page.getByRole("heading", { name: "Become a seller" })).toBeVisible();
  await page.getByLabel("Shop name").fill(shopName);
  await page.getByLabel("Description").fill("E2E onboarding test shop");
  await page.getByLabel(/Business registration/).fill("TAX-E2E-1");
  await page.getByRole("button", { name: "Submit application" }).click();
  // The form submits via server action + router.refresh(); status flips to pending.
  await expect(page.getByText("Pending review")).toBeVisible();
  // While PENDING the form is not editable (no resubmit button rendered).
  await expect(page.getByRole("button", { name: "Submit application" })).toBeHidden();

  await signOut(page);

  // --- admin: approve the application ---
  await login(page, ADMIN);
  await page.goto("/en/admin/applications");
  await expect(page.getByRole("heading", { name: "Seller applications" })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(shopName) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  // Decision is terminal: the row badge flips and the decision buttons leave.
  await expect(row.getByText("Approved")).toBeVisible();
  await expect(row.getByRole("button", { name: "Approve" })).toBeHidden();

  await signOut(page);

  // --- applicant: approval provisioned role + shop in one step ---
  await login(page, applicant);
  await page.goto("/en/seller");
  await expect(page.getByRole("heading", { name: "Seller Center" })).toBeVisible();
  await expect(page.getByText(shopName)).toBeVisible();
});

test("inventory adjustment: variant stock edit is reflected on the storefront", async ({
  page,
}) => {
  await login(page, SELLER);
  // Linen Shirt (prod_3, shop_1) — seeded Size L var_5.
  await page.goto("/en/seller/products");
  await page
    .getByRole("row", { name: /Linen Shirt/ })
    .getByRole("link", { name: "Edit" })
    .click();
  await page.waitForURL("**/en/seller/products/prod_3");

  // Second bordered variant row = Size L (input values aren't text, so locate
  // by position; field order: sku, nameEn, nameVi, base, sale, stock, attrs).
  const row = page.locator("form .grid.gap-3.rounded-lg.border").nth(1);
  const stock = row.locator("input").nth(5);
  const onHand = Number(await stock.inputValue());
  await stock.fill(String(onHand + 7));
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL("**/en/seller/products");

  // Storefront shows the new availability for the Size L option. The variant
  // select is controlled — before hydration the change is a no-op, so retry.
  await page.goto("/en/products/linen-shirt");
  await expect(async () => {
    await page.getByLabel("Variant").selectOption("var_5");
    await expect(page.locator("form p.font-medium")).toContainText(`${onHand + 7} in stock`, {
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });
});
