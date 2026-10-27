import { describe, expect, it } from "vitest";
import {
  StudioHistory,
  sameIdentity,
} from "../src/modules/studio-navigation/state";
describe("常驻工作台导航", () => {
  it("取消历史跳转仅补偿go，不生成新历史", () => {
    const h = new StudioHistory("session");
    expect(h.push()).toEqual({ session: "session", index: 1 });
    expect(h.push()).toEqual({ session: "session", index: 2 });
    expect(h.pop({ session: "session", index: 0 }, false)).toEqual({
      kind: "restore",
      delta: 2,
    });
    expect(h.locked).toBe(true);
    expect(h.pop({ session: "session", index: 2 }, false)).toEqual({
      kind: "compensated",
    });
    expect(h.index).toBe(2);
    expect(h.locked).toBe(false);
  });
  it("接受后退保留前进项，补偿期间禁止push", () => {
    const h = new StudioHistory("s");
    h.push();
    h.push();
    expect(h.pop({ session: "s", index: 1 }, true)).toEqual({ kind: "accept" });
    expect(h.pop({ session: "s", index: 2 }, true)).toEqual({ kind: "accept" });
    h.pop({ session: "s", index: 1 }, false);
    expect(() => h.push()).toThrow();
  });
  it("陌生session或非法历史不被当成本工作台导航", () => {
    const h = new StudioHistory("s");
    expect(h.pop({ session: "other", index: 0 }, true)).toEqual({
      kind: "external",
    });
    expect(h.pop({ session: "s", index: -1 }, true)).toEqual({
      kind: "external",
    });
  });
  it("恢复必须仍已登录且与SSR身份一致；协议错误fail closed", () => {
    expect(
      sameIdentity("a", {
        authenticated: true,
        trustedIdentity: "a",
        ownerConfigured: true,
      }),
    ).toBe(true);
    expect(
      sameIdentity("a", {
        authenticated: true,
        trustedIdentity: "b",
        ownerConfigured: true,
      }),
    ).toBe(false);
    expect(
      sameIdentity("a", {
        authenticated: false,
        trustedIdentity: "a",
        ownerConfigured: true,
      }),
    ).toBe(false);
    expect(
      sameIdentity(null, {
        authenticated: true,
        trustedIdentity: null,
        ownerConfigured: true,
      }),
    ).toBe(true);
    expect(sameIdentity("a", {})).toBe(false);
  });
});
