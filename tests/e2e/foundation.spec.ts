import { test, expect } from "@playwright/test";

test("基础页面加载并可在真实 BlockNote 中输入", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/MadeMe Studio/);
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Smoke E2E");
  await expect(editor).toContainText("Smoke E2E");
});
