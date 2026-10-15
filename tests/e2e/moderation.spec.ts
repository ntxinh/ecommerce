import { expect, test } from "@playwright/test";
import { ADMIN, login, SELLER, signOut } from "./helpers";

// Approve path lives in catalog.spec.ts ("seller draft → submit → admin
// approve → publish"). This covers the reject half of the moderation journey.
test("seller submits → admin rejects with reason → draft stays private, shows Rejected", async ({
  page,
}) => {
  const name = `E2E Reject ${Date.now()}`;

  // --- seller: create a draft and submit it for review ---
  await login(page, SELLER);
  await page.goto("/en/seller/products/new");
  await page.getByLabel("Name (English)").fill(name);
  await page.getByLabel("Name (Vietnamese)").fill("E2E từ chối");
  await page.getByLabel("Category").selectOption({ label: "Handicrafts" });
  await page.getByLabel("Description (English)").fill("Will be rejected.");

  await page.getByRole("button", { name: "Add variant" }).click();
  // Variant repeater inputs are unlabeled — order is
  // sku, nameEn, nameVi, basePrice, salePrice, stock, attrsJson.
  const fields = page.locator("form .grid.gap-3 input");
  await fields.nth(0).fill(`REJ-${Date.now()}`);
  await fields.nth(1).fill("Standard");
  await fields.nth(2).fill("Tiêu chuẩn");
  await fields.nth(3).fill("50000");
  await fields.nth(5).fill("10");

  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL("**/en/seller/products");

  const row = page.getByRole("row", { name });
  await row.getByRole("button", { name: "Submit for review" }).click();
  await expect(row.getByText("In review")).toBeVisible();
  await signOut(page);

  // --- admin: reject with a reason (reject requires the note) ---
  await login(page, ADMIN);
  await page.goto("/en/admin/moderation");
  const qrow = page.getByRole("row", { name });
  await expect(qrow).toBeVisible();
  await qrow.getByPlaceholder(/Reason/).fill("e2e: violates policy");
  await qrow.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Nothing awaiting review.")).toBeVisible();
  await signOut(page);

  // --- seller: back to Draft with Rejected badge, still not public ---
  await login(page, SELLER);
  await page.goto("/en/seller/products");
  await expect(row.getByText("Draft")).toBeVisible();
  await expect(row.getByText("Rejected")).toBeVisible();
  // REJECTED drafts can be resubmitted after edits.
  await expect(row.getByRole("button", { name: "Submit for review" })).toBeVisible();

  await page.goto(`/en/search?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name })).toBeHidden();
});
