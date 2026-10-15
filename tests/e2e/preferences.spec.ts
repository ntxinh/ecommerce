import { expect, type Page, test } from "@playwright/test";

// Dev-server turbulence: Turbopack keeps an in-flight "navigation" alive
// (HMR, wishlist fetch on first mount) and the radix menus aren't openable
// until React hydrates. Retry the trigger click until the menu item renders —
// the same controlled-input retry pattern as catalog.spec's search box.
async function pickMenu(page: Page, trigger: string, item: string) {
  await expect(async () => {
    await page.keyboard.press("Escape"); // reset half-open menus across retries
    await page.getByRole("button", { name: trigger }).click({ timeout: 5_000 });
    await expect(page.getByRole("menuitem", { name: item })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("menuitem", { name: item }).click();
}

test("locale switcher swaps EN ↔ VI on the same page", async ({ page }) => {
  await page.goto("/en/categories/fashion");
  await expect(page.getByRole("heading", { name: "Fashion", level: 1 })).toBeVisible();

  // The locale trigger's aria-label is "Language" in every locale.
  await pickMenu(page, "Language", "Tiếng Việt");
  await page.waitForURL("**/vi/categories/fashion");
  await expect(page.getByRole("heading", { name: "Thời trang", level: 1 })).toBeVisible();

  await pickMenu(page, "Language", "English");
  await page.waitForURL("**/en/categories/fashion");
  await expect(page.getByRole("heading", { name: "Fashion", level: 1 })).toBeVisible();
});

test("theme switcher: light → dark → system follows the OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/en");

  const html = page.locator("html");

  await pickMenu(page, "System", "Light");
  await expect(html).not.toHaveClass(/dark/);

  await pickMenu(page, "System", "Dark");
  await expect(html).toHaveClass(/dark/);

  // System resolves to the emulated OS scheme (dark here).
  await pickMenu(page, "System", "System");
  await expect(html).toHaveClass(/dark/);

  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).not.toHaveClass(/dark/);
});
