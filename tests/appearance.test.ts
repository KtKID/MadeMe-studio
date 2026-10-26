import { describe, it, expect } from "vitest";
import {
  appearanceAttributes,
  accentOverrideStyle,
  resolveMode,
  fontStacks,
  updateAppearance,
} from "../src/components/shared/appearance";
// 先固定行为：皮肤、明暗模式、字体是三个独立维度，修改任何一个都不能覆盖另两个。
describe("外观维度解耦", () => {
  const initial = {
    mode: "system" as const,
    skin: "amber" as const,
    font: "yahei" as const,
  };
  it("默认外观为暖黄皮肤、跟随系统和微软雅黑", () => {
    expect(appearanceAttributes(initial)).toEqual({
      "data-mode": "system",
      "data-skin": "amber",
      "data-font": "yahei",
    });
    expect(fontStacks.yahei).toContain("Microsoft YaHei");
    expect(fontStacks.yahei).toContain("微软雅黑");
  });
  it("换皮肤不改变模式或字体", () => {
    expect(updateAppearance(initial, { skin: "ocean" })).toEqual({
      mode: "system",
      skin: "ocean",
      font: "yahei",
    });
  });
  it("切换暗色不改变皮肤或字体", () => {
    expect(updateAppearance(initial, { mode: "dark" })).toEqual({
      mode: "dark",
      skin: "amber",
      font: "yahei",
    });
  });
  it("字体变化不影响颜色外观", () => {
    expect(updateAppearance(initial, { font: "serif" })).toEqual({
      mode: "system",
      skin: "amber",
      font: "serif",
    });
  });
  it("system 跟随系统，明确指定明暗优先", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });
});

describe("强调色覆盖与皮肤独立", () => {
  it("默认无强调色覆盖，切换皮肤使用自身tokens", () => {
    expect(accentOverrideStyle(null)).toBeUndefined();
    expect(accentOverrideStyle(undefined)).toBeUndefined();
  });
  it("只有验证后的自定义颜色才能成为行内变量", () => {
    expect(accentOverrideStyle("#123456")).toBe("--accent:#123456");
    expect(accentOverrideStyle("red;background:url(x)")).toBeUndefined();
  });
});
