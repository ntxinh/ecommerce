import { expect, test } from "@playwright/test";
import { fillField, login, selectOption, signOut, submitForUrl, tap, tapToUrl } from "./helpers";

// The cross-role journey publishes a product into shop_1 — serial keeps the
// read-only tests' shop/category assertions immune to that write.
test.describe.configure({ mode: "serial" });

test("homepage renders catalog sections", async ({ page }) => {
  await page.goto("/en");

  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Handicrafts" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flash Sale" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured Shops" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Saigon Crafts" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trending" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New Arrivals" })).toBeVisible();
  // ACTIVE products appear; the seeded DRAFT never leaks into public lists.
  await expect(page.getByRole("link", { name: "Handmade Ceramic Mug" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Unlisted Vase" })).toBeHidden();
});

test("search: autocomplete → results → product page", async ({ page }) => {
  await page.goto("/en");

  const box = page.getByRole("combobox", { name: "Search products" });
  // The controlled input ignores typing until React hydrates; retry the fill
  // until the debounced suggest dropdown renders (suggest is a name-prefix
  // match, so the term must prefix "Ceramic Teapot").
  await expect(async () => {
    await box.fill("ceramic");
    await expect(page.getByRole("option", { name: /Teapot/ })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });

  await tapToUrl(
    page.getByRole("button", { name: "Search", exact: true }),
    /\/en\/search\?q=ceramic/,
  );
  await expect(page.getByRole("heading", { name: /Results for .ceramic./ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ceramic Teapot" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Cotton Scarf" })).toBeHidden();

  await tapToUrl(
    page.getByRole("link", { name: "Ceramic Teapot" }).first(),
    /\/en\/products\/ceramic-teapot/,
  );
  await expect(page.getByRole("heading", { name: "Ceramic Teapot" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Saigon Crafts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
});

test("category browse + price filter", async ({ page }) => {
  await page.goto("/en/categories/fashion");
  await expect(page.getByRole("heading", { name: "Fashion", level: 1 })).toBeVisible();
  // Descendants included: all three apparel products (scarf/hat in shop_2).
  await expect(page.getByRole("link", { name: "Linen Shirt" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Cotton Scarf" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Straw Hat" }).first()).toBeVisible();

  // Max price 130000₫ hides Linen Shirt (from 299000₫), keeps scarf + hat.
  // FiltersBar submits a client navigation — retry until the URL lands.
  await fillField(page.getByPlaceholder("Max"), "130000");
  await tapToUrl(
    page.getByRole("button", { name: "Apply", exact: true }),
    /\/en\/categories\/fashion\?maxPriceVnd=130000/,
  );

  await expect(page.getByRole("link", { name: "Cotton Scarf" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Straw Hat" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Linen Shirt" })).toBeHidden();
});

test("shop storefront lists only that shop's public products", async ({ page }) => {
  await page.goto("/en/shops/saigon-crafts");

  await expect(page.getByRole("heading", { name: "Saigon Crafts", level: 1 })).toBeVisible();
  await expect(page.getByText("3 products")).toBeVisible();
  await expect(page.getByRole("link", { name: "Handmade Ceramic Mug" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Ceramic Teapot" }).first()).toBeVisible();
  // Other shop's product and this shop's DRAFT are excluded.
  await expect(page.getByRole("link", { name: "Bamboo Basket" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Unlisted Vase" })).toBeHidden();
});

// Moderation gates visibility, not status: approve flips moderationStatus to
// APPROVED but the seller still publishes (DRAFT → ACTIVE) to go public.
test("seller draft → submit → admin approve → publish → publicly visible", async ({ page }) => {
  const name = `E2E Lantern ${Date.now()}`;

  // --- seller: create a DRAFT with one variant ---
  await login(page, "seller@marketflow.dev");
  await page.goto("/en/seller/products/new");
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();

  await fillField(page.getByLabel("Name (English)"), name);
  await fillField(page.getByLabel("Name (Vietnamese)"), "Đèn lồng E2E");
  await selectOption(page.getByLabel("Category"), { label: "Handicrafts" });
  await fillField(page.getByLabel("Description (English)"), "Paper lantern for e2e.");

  const fields = page.locator("form .grid.gap-3 input");
  await tap(page.getByRole("button", { name: "Add variant" }), () =>
    expect(fields.nth(0)).toBeVisible({ timeout: 5_000 }),
  );
  // Variant repeater inputs are unlabeled — order is
  // sku, nameEn, nameVi, basePrice, salePrice, stock, attrsJson.
  await fillField(fields.nth(0), `LNT-${Date.now()}`);
  await fillField(fields.nth(1), "Standard");
  await fillField(fields.nth(2), "Tiêu chuẩn");
  await fillField(fields.nth(3), "50000");
  await fillField(fields.nth(5), "25");

  await submitForUrl(page.getByRole("button", { name: "Save product" }), /\/en\/seller\/products/);

  const row = page.getByRole("row", { name });
  await expect(row).toBeVisible();
  await expect(row.getByText("Draft")).toBeVisible();

  // --- seller: submit for review ---
  await tap(row.getByRole("button", { name: "Submit for review" }), () =>
    expect(row.getByText("In review")).toBeVisible({ timeout: 10_000 }),
  );
  await signOut(page);

  // --- admin: approve in the moderation queue ---
  await login(page, "admin@marketflow.dev");
  await page.goto("/en/admin/moderation");
  await expect(page.getByRole("heading", { name: "Product moderation" })).toBeVisible();
  await tap(page.getByRole("row", { name }).getByRole("button", { name: "Approve" }), () =>
    expect(page.getByText("Nothing awaiting review.")).toBeVisible({ timeout: 10_000 }),
  );

  // Approved ≠ public: the DRAFT stays hidden until the seller publishes it.
  await page.goto(`/en/search?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name }).first()).toBeHidden();
  await signOut(page);

  // --- seller: publish the approved draft ---
  await login(page, "seller@marketflow.dev");
  await page.goto("/en/seller/products");
  await tap(page.getByRole("row", { name }).getByRole("button", { name: "Publish" }), () =>
    expect(row.getByText("Active")).toBeVisible({ timeout: 10_000 }),
  );

  // --- customer-facing: findable via search and the product page renders ---
  await page.goto(`/en/search?q=${encodeURIComponent(name)}`);
  await tapToUrl(page.getByRole("link", { name }).first(), /\/en\/products\//);
  await expect(page.getByRole("heading", { name })).toBeVisible();
});
