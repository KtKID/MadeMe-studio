import { test, expect } from "@playwright/test";

// 仅使用隔离作者环境；变更只留在输入框，不写入服务端设置。
test("@author 后台客户端切页与未保存设置保护", async ({ page, request }) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(bootstrap.capabilities?.authenticated).toBe(true);
  await page.goto("/studio");
  const documentStart = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "站点设置", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await expect(page.getByLabel("站点名称", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
  await page.getByLabel("站点名称", { exact: true }).fill("未保存导航验收");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "媒体库", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await expect(page.getByLabel("站点名称", { exact: true })).toHaveValue(
    "未保存导航验收",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "媒体库", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/media$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
});
