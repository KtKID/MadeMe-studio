import { test, expect } from "@playwright/test";

test("设置导航在延迟水合期间禁用，就绪后点击一次即显示模式与字体", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? error.message),
  );
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let heldScripts = 0;
  // 保留真实 SSR HTML 与样式，只阻塞浏览器脚本，确保尚未绑定事件。
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      heldScripts++;
      await hold;
    }
    await route.continue();
  });
  try {
    await page.goto("/studio/settings", { waitUntil: "commit" });
    const nav = page.getByRole("navigation", { name: "设置分类" });
    await expect(nav).toBeVisible();
    await expect.poll(() => heldScripts).toBeGreaterThan(0);
    await expect(page.locator("[data-studio-ready=true]")).toHaveCount(0);
    const buttons = nav.getByRole("button");
    expect(await buttons.count()).toBeGreaterThan(1);
    for (const button of await buttons.all())
      await expect(button).toBeDisabled();
    release();
    await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
    for (const button of await buttons.all())
      await expect(button).toBeEnabled();
    await nav.getByRole("button", { name: "主题与字体", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "深色", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "正文字体" }),
    ).toBeVisible();
    await expect(page.getByLabel("站点名称", { exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    release();
    await testInfo.attach("browser-errors", {
      body: JSON.stringify({ pageErrors, consoleErrors }, null, 2),
      contentType: "application/json",
    });
  }
});
