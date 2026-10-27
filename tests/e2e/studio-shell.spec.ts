import { test, expect, type Page } from "@playwright/test";
async function ready(page: Page, path = "/studio") {
  await page.goto(path);
  await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
}
const tab = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true });
test("四个深链SSR、会话内切换不请求HTML或重复列表，ready与当前pane一致", async ({
  page,
}) => {
  await ready(page, "/studio?perf=1");
  const start = await page.evaluate(() => performance.timeOrigin);
  const requests: string[] = [];
  page.on("request", (r) => {
    if (
      r.isNavigationRequest() ||
      /\/api\/(bootstrap|media|tokens)(\?|$)/.test(r.url())
    )
      requests.push(r.url());
  });
  for (const [name, path] of [
    ["媒体库", "/studio/media"],
    ["站点设置", "/studio/settings"],
    ["连接与发布", "/studio/integrations"],
    ["所有文章", "/studio"],
  ]) {
    await tab(page, name!).click();
    await expect(page).toHaveURL(
      new RegExp(`${path!.replaceAll("/", "\\/")}\\?perf=1$`),
    );
    await expect(page.locator(".studio-pane:not([hidden])")).toHaveCount(1);
    await expect
      .poll(
        async () =>
          JSON.parse(
            await page.locator("#navigation-performance-json").innerText(),
          ).samples.at(-1).status,
      )
      .toBe("ready");
  }
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(start);
  await page.reload();
  await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
});
test("设置取消与放弃保持真实history；取消前进后仍可再前进", async ({
  page,
}) => {
  await ready(page);
  await tab(page, "站点设置").click();
  const input = page.getByLabel("站点名称", { exact: true });
  const saved = await input.inputValue();
  await input.fill("未保存取消");
  page.once("dialog", (d) => d.dismiss());
  await tab(page, "媒体库").click();
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await expect(input).toHaveValue("未保存取消");
  page.once("dialog", (d) => d.dismiss());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/studio\/settings$/);
  page.once("dialog", (d) => d.accept());
  await tab(page, "媒体库").click();
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await expect(input).toHaveValue(saved);
  await input.fill("第二次取消");
  page.once("dialog", (d) => d.dismiss());
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(/\/studio\/settings$/);
  await expect(input).toHaveValue("第二次取消");
  page.once("dialog", (d) => d.accept());
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(/\/studio\/media$/);
});
test("身份恢复前遮蔽，身份变化或失败不能恢复私有pane", async ({ page }) => {
  await ready(page, "/studio/settings");
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  await page.route("**/api/identity", async (route) => {
    await hold;
    await route.fulfill({
      json: {
        authenticated: true,
        trustedIdentity: "different-owner",
        ownerConfigured: true,
      },
    });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect(page.getByLabel("站点名称", { exact: true })).not.toBeVisible();
  release();
  await expect(
    page.getByText("需要重新验证作者身份，请刷新页面或登录后继续。"),
  ).toBeVisible();
  await expect(page.locator(".studio-pane")).toHaveCount(0);
});
test("401失效后迟到同身份恢复响应不能复活私有数据", async ({
  page,
  request,
}) => {
  const identity = await (await request.get("/api/identity")).json();
  await ready(page, "/studio/settings");
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  await page.route("**/api/identity", async (route) => {
    await hold;
    await route.fulfill({ json: identity });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("mademe:identity-invalid")),
  );
  release();
  await expect(page.locator(".studio-pane")).toHaveCount(0);
  await expect(
    page.getByText("需要重新验证作者身份，请刷新页面或登录后继续。"),
  ).toBeVisible();
});
test("一次性secret离开清空，迟到创建响应不会在返回后复活", async ({ page }) => {
  await ready(page, "/studio/integrations");
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    arrived = new Promise<void>((r) => (started = r));
  await page.route("**/api/tokens", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    started();
    await hold;
    await route.fulfill({
      json: {
        id: "fixture",
        name: "测试",
        scopes: ["posts:read"],
        createdAt: "2026-10-27T00:00:00Z",
        expiresAt: "2026-11-27T00:00:00Z",
        lastUsedAt: null,
        token: "mm_" + "a".repeat(64),
      },
    });
  });
  await page.getByRole("button", { name: "创建令牌", exact: true }).click();
  await page.getByLabel("用途名称").fill("隔离测试");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建令牌", exact: true })
    .click();
  await arrived;
  // modal覆盖页面时，以正常DOM链接click走同一导航处理器。
  await tab(page, "媒体库").evaluate((element: HTMLElement) => element.click());
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tokens") &&
      response.request().method() === "GET",
  );
  release();
  await refreshed;
  await tab(page, "连接与发布").click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".secret-card")).toHaveCount(0);
});
