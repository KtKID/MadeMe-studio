import { expect, test } from "@playwright/test";

// 只改新文章输入框，不保存或创建服务端文章，不影响用户内容。
test("@author 写作返回和侧栏使用站内提示，取消保留输入，确认无原生二次弹窗", async ({
  page,
  request,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(bootstrap.capabilities?.authenticated).toBe(true);
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.goto("/studio/new");
  await page.getByLabel("文章标题").fill("未保存返回回归");
  await page.getByTitle("返回写作台", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "还有未保存的修改" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/studio\/new$/);
  await expect(page.getByLabel("文章标题")).toHaveValue("未保存返回回归");
  await page.getByRole("link", { name: "媒体库", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("文章标题")).toHaveValue("未保存返回回归");
  await page.getByTitle("返回写作台", { exact: true }).click();
  await dialog.getByRole("button", { name: "丢弃修改并返回" }).click();
  await expect(page).toHaveURL(/\/studio$/);
  expect(nativeDialogs).toEqual([]);
});

test("@author 真正刷新仍保护未保存文章，不静默丢失", async ({ page }) => {
  await page.goto("/studio/new");
  await page.getByLabel("文章标题").fill("刷新不能丢失");
  const shown = page.waitForEvent("dialog");
  const reload = page.reload().catch((error) => {
    if (!String(error).includes("ERR_ABORTED")) throw error;
  });
  const dialog = await shown;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload;
  await expect(page.getByLabel("文章标题")).toHaveValue("刷新不能丢失");
});
