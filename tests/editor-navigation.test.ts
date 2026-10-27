import { describe, expect, it, vi } from "vitest";
import { createEditorLeaveGuard } from "../src/components/editor/editor-navigation";

describe("编辑器站内离开保护", () => {
  it("导航动作异常后立即恢复未保存保护", () => {
    const guard = createEditorLeaveGuard({
      isDirty: () => true,
      isBusy: () => false,
      show: vi.fn(),
    });
    guard.request(() => {
      throw new Error("navigation failed");
    });
    expect(() => guard.confirm()).toThrow("navigation failed");
    expect(guard.shouldBlockUnload()).toBe(true);
  });
  it("未保存返回先显示站内提示，取消不跳转且保留原生刷新保护", () => {
    const show = vi.fn(),
      navigate = vi.fn();
    const guard = createEditorLeaveGuard({
      isDirty: () => true,
      isBusy: () => false,
      show,
    });
    guard.request(navigate);
    expect(show).toHaveBeenLastCalledWith(true);
    expect(navigate).not.toHaveBeenCalled();
    guard.cancel();
    expect(navigate).not.toHaveBeenCalled();
    expect(guard.shouldBlockUnload()).toBe(true);
  });
  it("明确放弃后只放行一次卸载，不出现二次浏览器提示", () => {
    const navigate = vi.fn();
    const guard = createEditorLeaveGuard({
      isDirty: () => true,
      isBusy: () => false,
      show: vi.fn(),
    });
    guard.request(navigate);
    guard.confirm();
    expect(navigate).toHaveBeenCalledOnce();
    expect(guard.shouldBlockUnload()).toBe(false);
    expect(guard.shouldBlockUnload()).toBe(true);
  });
  it("重复点击不覆盖待确认目标，关闭后允许选择新目标", () => {
    const first = vi.fn(),
      second = vi.fn();
    const guard = createEditorLeaveGuard({
      isDirty: () => true,
      isBusy: () => false,
      show: vi.fn(),
    });
    guard.request(first);
    guard.request(second);
    guard.confirm();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    guard.reset();
    guard.request(second);
    guard.cancel();
    guard.request(second);
    guard.confirm();
    expect(second).toHaveBeenCalledOnce();
  });
  it("保存中禁止离开，保存后新输入仍受保护", () => {
    let busy = true,
      dirty = false;
    const show = vi.fn(),
      navigate = vi.fn();
    const guard = createEditorLeaveGuard({
      isDirty: () => dirty,
      isBusy: () => busy,
      show,
    });
    guard.request(navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(guard.shouldBlockUnload()).toBe(true);
    busy = false;
    dirty = true;
    guard.request(navigate);
    busy = true;
    guard.confirm();
    expect(navigate).not.toHaveBeenCalled();
    busy = false;
    guard.confirm();
    expect(navigate).toHaveBeenCalledOnce();
  });
  it("无修改直接返回；bfcache 恢复后撤销历史放行", () => {
    let dirty = false;
    const navigate = vi.fn(),
      show = vi.fn();
    const guard = createEditorLeaveGuard({
      isDirty: () => dirty,
      isBusy: () => false,
      show,
    });
    guard.request(navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
    dirty = true;
    guard.request(navigate);
    guard.confirm();
    guard.reset();
    expect(guard.shouldBlockUnload()).toBe(true);
  });
});

import { editorLinkDestination } from "../src/components/editor/editor-navigation";
describe("站内链接筛选", () => {
  it("返回、侧栏链接被统一识别，下载/新标签/修饰点击/外站/锚点不干预", () => {
    class Link {
      constructor(public attrs: Record<string, string>) {}
      closest() {
        return this;
      }
      getAttribute(key: string) {
        return this.attrs[key] ?? null;
      }
      hasAttribute(key: string) {
        return key in this.attrs;
      }
    }
    const original = globalThis.Element;
    Object.defineProperty(globalThis, "Element", {
      configurable: true,
      value: Link,
    });
    const current = "https://made.test/studio/edit?id=one";
    const event = (attrs: Record<string, string>, extra = {}) =>
      ({
        button: 0,
        defaultPrevented: false,
        composedPath: () => [new Link(attrs)],
        ...extra,
      }) as unknown as MouseEvent;
    try {
      expect(editorLinkDestination(event({ href: "/studio" }), current)).toBe(
        "https://made.test/studio",
      );
      expect(
        editorLinkDestination(event({ href: "/studio/media" }), current),
      ).toBe("https://made.test/studio/media");
      expect(
        editorLinkDestination(
          event({ href: "/studio/edit?id=one" }),
          `${current}#main`,
        ),
      ).toBeUndefined();
      for (const item of [
        event({ href: "/studio", target: "_blank" }),
        event({ href: "/file", download: "" }),
        event({ href: "#section" }),
        event({ href: "https://other.test" }),
        event({ href: "/studio" }, { ctrlKey: true }),
        event({ href: "/studio" }, { button: 1 }),
        event({ href: "/studio" }, { defaultPrevented: true }),
      ])
        expect(editorLinkDestination(item, current)).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "Element", {
        configurable: true,
        value: original,
      });
    }
  });
});
