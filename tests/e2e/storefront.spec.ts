import { expect, test } from "@playwright/test";
import { registerCustomer } from "./helpers";

test("sort: price ascending orders the category grid", async ({ page }) => {
  await page.goto("/en/categories/fashion");
  // The FiltersBar select is a controlled client component — before hydration
  // selectOption is a no-op, so retry until the client nav lands. Same
  // controlled-input retry pattern as catalog.spec's search box.
  await expect(async () => {
    // [0] sort, [1] min-rating (the search combobox lives in the header).
    await page.locator("main select").first().selectOption("price_asc");
    await expect(page).toHaveURL(/sort=price_asc/, { timeout: 15_000 });
  }).toPass({ timeout: 60_000 });
  const firstCard = page.locator("main a[href^='/en/products/']").first();
  await expect(firstCard).toHaveAttribute("href", /straw-hat/);
});

test("variant selection updates price; qty and remove work in the cart", async ({ page }) => {
  // Fresh customer per run: server cart starts empty, so leftover lines from a
  // failed run can't pollute the qty/remove assertions.
  await registerCustomer(page, `e2e-cart-${Date.now()}@marketflow.dev`);

  await page.goto("/en/products/linen-shirt");
  // Same hydration retry as the sort select — the option swap drives a
  // controlled React state update.
  await expect(async () => {
    await page.getByLabel("Variant").selectOption("var_5");
    await expect(page.getByText(/₫350,000\s*\d+ in stock/)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("Variant").selectOption("var_4");
  await expect(page.getByText(/₫299,000\s*\d+ in stock/)).toBeVisible();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();

  await page.goto("/en/cart");
  const row = page.getByRole("row", { name: /SHIRT-LIN-M/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Increase quantity" }).click();
  await expect(row.getByText("2", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toBeHidden();
  await expect(page.getByText("Your cart is empty")).toBeVisible();
});
