import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("后台使用客户端路由，编辑器入口明确完整导航", () => {
  const base = readFileSync("src/layouts/Base.astro", "utf8");
  const studio = readFileSync("src/layouts/Studio.astro", "utf8");
  expect(base).toContain("ClientRouter");
  expect(studio).toContain("clientNavigation={!editingPage}");
  expect(studio).toContain("data-astro-reload");
});
it("设置在客户端切页前保护未保存输入", () => {
  const source = readFileSync(
    "src/components/settings/SettingsPanel.tsx",
    "utf8",
  );
  expect(source).toContain("installUnsavedGuard");
});

import { installUnsavedGuard } from "../../src/components/shared/unsaved-guard";
it("取消切页保留输入，确认允许导航，卸载移除拦截", () => {
  const target = new EventTarget();
  const cleanup = installUnsavedGuard(target, () => false);
  const event = new Event("astro:before-preparation", { cancelable: true });
  expect(target.dispatchEvent(event)).toBe(false);
  expect(
    target.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  ).toBe(false);
  cleanup();
  expect(
    target.dispatchEvent(
      new Event("astro:before-preparation", { cancelable: true }),
    ),
  ).toBe(true);
  const cleanup2 = installUnsavedGuard(target, () => true);
  expect(
    target.dispatchEvent(
      new Event("astro:before-preparation", { cancelable: true }),
    ),
  ).toBe(true);
  cleanup2();
});

it("阅读页只获取能力且编辑入口不静态加载整个编辑器", () => {
  const page = readFileSync("src/pages/p/[slug].astro", "utf8");
  const inline = readFileSync("src/components/editor/InlineEditor.tsx", "utf8");
  expect(page.includes('loadPageData(Astro, false, { posts: "none" })')).toBe(
    true,
  );
  expect(inline.includes('lazy(() => import("./Editor"))')).toBe(true);
  expect(inline.includes('import Editor from "./Editor"')).toBe(false);
});
