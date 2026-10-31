import { test, expect, type Page } from "@playwright/test";
import { fontOptions } from "../../src/components/settings/model-options";
const fontLabels = Object.fromEntries(
  fontOptions.map((o) => [o.value, o.label]),
) as Record<string, string>;
/** 正文字体为共享自定义下拉，通过真实点击选项而非 selectOption。 */
async function chooseFont(page: Page, font: string) {
  await page.getByRole("combobox", { name: "正文字体" }).click();
  await page
    .getByRole("option", { name: fontLabels[font], exact: true })
    .click();
}
async function openAppearance(page: Page) {
  await page.goto("/studio/settings");
  await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
  const appearance = page.getByRole("button", {
    name: "主题与字体",
    exact: true,
  });
  await expect(appearance).toBeEnabled();
  await appearance.click();
  await expect(
    page.getByRole("button", { name: "深色", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "正文字体" })).toBeVisible();
}
test.describe.configure({ mode: "serial" });
test("@author 设置回归：延迟PATCH只提交dirty字段且保留后续字体修改", async ({
  page,
  request,
  baseURL,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(bootstrap.capabilities?.authenticated, "设置验收需要作者身份").toBe(
    true,
  );
  const original = bootstrap.settings;
  const mode = original.mode === "dark" ? "light" : "dark";
  const font = original.font === "mono" ? "serif" : "mono";
  let release!: () => void;
  let arrived!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (arrived = resolve));
  let payload: Record<string, unknown> = {};
  try {
    await openAppearance(page);
    await page
      .getByRole("button", {
        name: mode === "dark" ? "深色" : "浅色",
        exact: true,
      })
      .click();
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      payload = route.request().postDataJSON();
      const response = await route.fetch();
      arrived();
      await wait;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await started;
    await chooseFont(page, font);
    release();
    await expect(page.getByRole("status")).toContainText("仍未保存");
    await expect(page.getByRole("combobox", { name: "正文字体" })).toHaveText(
      fontLabels[font],
    );
    await expect(page.locator(".settings-dirty")).toHaveText("有未保存设置");
    expect(Object.keys(payload)).toEqual(["mode"]);
  } finally {
    release?.();
    await request.patch("/api/settings", {
      headers: { Origin: new URL(baseURL!).origin },
      data: { mode: original.mode, font: original.font },
    });
  }
});
test("@author 设置回归：两个窗口分别改mode与font不会互相覆盖", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(bootstrap.capabilities?.authenticated).toBe(true);
  const original = bootstrap.settings;
  const mode = original.mode === "dark" ? "light" : "dark";
  const font = original.font === "serif" ? "mono" : "serif";
  const second = await context.newPage();
  try {
    for (const target of [page, second]) await openAppearance(target);
    await page
      .getByRole("button", {
        name: mode === "dark" ? "深色" : "浅色",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("设置已保存");
    await chooseFont(second, font);
    await second.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(second.getByRole("status")).toContainText("设置已保存");
    const result = await (await request.get("/api/settings")).json();
    expect(result.settings.mode).toBe(mode);
    expect(result.settings.font).toBe(font);
  } finally {
    await second.close();
    await request.patch("/api/settings", {
      headers: { Origin: new URL(baseURL!).origin },
      data: { mode: original.mode, font: original.font },
    });
  }
});
