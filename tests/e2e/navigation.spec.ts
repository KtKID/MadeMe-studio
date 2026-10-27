import { test, expect, type Page } from "@playwright/test";

// 仅使用隔离作者环境；变更只留在输入框，不写入服务端设置。
async function expectCanceledLeave(
  page: Page,
  action: () => Promise<unknown>,
  dialogType = "beforeunload",
) {
  const dialogSeen = page.waitForEvent("dialog");
  const actionDone = action().catch((error: unknown) => {
    // 浏览器取消整页导航时，Playwright 的导航等待可能返回 ERR_ABORTED。
    if (!String(error).includes("ERR_ABORTED")) throw error;
  });
  const dialog = await dialogSeen;
  expect(dialog.type()).toBe(dialogType);
  await dialog.dismiss();
  await actionDone;
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await expect(page.getByLabel("站点名称", { exact: true })).toHaveValue(
    "未保存导航验收",
  );
}

test("@author 常驻设置保护链接、历史回退和程序化地址跳转", async ({
  page,
  request,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(bootstrap.capabilities?.authenticated).toBe(true);
  await page.goto("/studio");
  await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
  const documentStart = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "站点设置", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/settings$/);
  const input = page.getByLabel("站点名称", { exact: true });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
  await input.fill("未保存导航验收");
  await expect(page.getByText("有未保存设置", { exact: true })).toBeVisible();
  await expectCanceledLeave(
    page,
    () => page.getByRole("link", { name: "媒体库", exact: true }).click(),
    "confirm",
  );
  await expectCanceledLeave(page, () => page.goBack(), "confirm");
  await expectCanceledLeave(page, () =>
    page.evaluate(() => {
      window.location.href = "/studio/media";
    }),
  );
  await expectCanceledLeave(page, () => page.reload());
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "媒体库", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/media$/);
  const mediaDocument = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "连接与发布", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/integrations$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(mediaDocument);
});

test("@author 未保存设置取消浏览器前进后保留输入", async ({ page }) => {
  await page.goto("/studio/settings");
  await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
  await expect(page.getByLabel("站点名称", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "媒体库", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/media$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await page.getByLabel("站点名称", { exact: true }).fill("未保存导航验收");
  await expect(page.getByText("有未保存设置", { exact: true })).toBeVisible();
  await expectCanceledLeave(page, () => page.goForward(), "confirm");
});
