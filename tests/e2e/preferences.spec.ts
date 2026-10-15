import { expect, type Page, test } from "@playwright/test";

// Dev-server turbulence: Turbopack keeps an in-flight "navigation" alive
// (HMR, wishlist fetch on first mount, Fast Refresh re-renders), so trusted
// clicks stall on actionability for tens of seconds and the radix menus
// aren't openable until React hydrates. dispatchEvent skips the
// actionability wait entirely — Radix opens on pointerdown, and React's root
// click listener fires onSelect for a dispatched click. Escape resets a
// half-open menu between attempts.
async function pickMenu(page: Page, trigger: string, item: string) {
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: trigger }).dispatchEvent("pointerdown");
    const choice = page.getByRole("menuitem", { name: item });
    await expect(choice).toBeVisible({ timeout: 5_000 });
    await choice.dispatchEvent("click");
  }).toPass({ timeout: 120_000 });
}

test("locale switcher swaps EN ↔ VI on the same page", async ({ page }) => {
  await page.goto("/en/categories/fashion");
  await page.waitForLoadState("domcontentloaded");
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
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: "Flash Sale" })).toBeVisible();

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
