import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("编辑器保留完整导航，工作台深链共享单个SSR外壳", () => {
  const studio = readFileSync("src/layouts/Studio.astro", "utf8");
  expect(studio).toContain('"/studio/edit"');
  expect(studio).toContain("clientNavigation={!protectedFormPage}");
  const workspace = readFileSync("src/layouts/StudioWorkspace.astro", "utf8");
  expect(workspace).toContain("loadStudioPageData(Astro)");
  expect(workspace).not.toContain("ClientRouter");
});

it("设置在客户端切页前保护未保存输入", () => {
  const source = readFileSync(
    "src/components/settings/SettingsPanel.tsx",
    "utf8",
  );
  expect(source).toContain("installUnsavedGuard");
});

import { installUnsavedGuard } from "../../src/components/shared/unsaved-guard";
it("未保存保护使用原生卸载，不使用会触发整页 fallback 的 Astro 事件", () => {
  const target = new EventTarget();
  const cleanup = installUnsavedGuard(target);
  const event = new Event("beforeunload", { cancelable: true });
  Object.defineProperty(event, "returnValue", {
    value: undefined,
    writable: true,
  });
  expect(target.dispatchEvent(event)).toBe(false);
  expect(event.returnValue).toBe("");
  cleanup();
  expect(
    target.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  ).toBe(true);
  const source = readFileSync("src/components/shared/unsaved-guard.ts", "utf8");
  expect(source).not.toContain('addEventListener("astro:before-preparation"');
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

it("设置链接取消不导航，确认只弹一次且原生守卫保留到确认前", () => {
  class Link extends EventTarget {
    closest() {
      return this;
    }
    getAttribute(name: string) {
      return name === "href" ? "/studio/media" : null;
    }
    hasAttribute() {
      return false;
    }
  }
  const originalElement = globalThis.Element;
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: Link,
  });
  try {
    const documentTarget = new Link();
    const windowTarget = new EventTarget();
    let allow = false;
    let confirmations = 0;
    const cleanup = installUnsavedGuard(windowTarget, {
      documentTarget,
      confirmLeave: () => {
        confirmations++;
        return allow;
      },
      currentUrl: () => "https://example.test/studio/settings",
    });
    let navigationHandlers = 0;
    documentTarget.addEventListener("click", () => {
      navigationHandlers++;
    });
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      Object.defineProperty(event, "returnValue", {
        value: undefined,
        writable: true,
      });
      return windowTarget.dispatchEvent(event);
    };
    expect(
      documentTarget.dispatchEvent(new Event("click", { cancelable: true })),
    ).toBe(false);
    expect(unload()).toBe(false);
    expect(navigationHandlers).toBe(0);
    allow = true;
    expect(
      documentTarget.dispatchEvent(new Event("click", { cancelable: true })),
    ).toBe(true);
    expect(confirmations).toBe(2);
    expect(navigationHandlers).toBe(1);
    expect(unload()).toBe(true);
    expect(unload()).toBe(false);
    cleanup();
  } finally {
    Object.defineProperty(globalThis, "Element", {
      configurable: true,
      value: originalElement,
    });
  }
});
