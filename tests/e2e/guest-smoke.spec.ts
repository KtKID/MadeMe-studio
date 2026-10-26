import { test, expect } from "@playwright/test";
// 访客冒烟独立于作者场景，不以作者权限缺失掩盖端到端失败。
test("@guest 冒烟：首页、工作台入口与窄屏无横向溢出", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/MadeMe/);
  await expect(page.locator("h1")).toContainText("记录所想");
  await expect(
    page.getByRole("link", { name: /工作台|写作台/ }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("main")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
