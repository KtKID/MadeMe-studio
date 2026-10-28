import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const css = readFileSync(
  new URL("../src/styles/global.css", import.meta.url),
  "utf8",
);
describe("Obsidian文字入口的窄范围hover契约", () => {
  it("只在写作快捷栏该入口取消悬停底色，不新增focus或状态覆盖", () => {
    const rule =
      /\.writing-shortcuts > \.obsidian-save-trigger:hover\s*\{([^}]+)\}/.exec(
        css,
      );
    expect(rule).not.toBeNull();
    expect(rule?.[1].trim()).toBe("background: transparent;");
  });
  it("其它通用按钮hover和键盘focus-visible规则仍然保留", () => {
    expect(css).toMatch(/\.button:hover\s*\{[^}]*background: var\(--soft\)/);
    expect(css).toMatch(
      /:focus-visible\s*\{[^}]*outline: 2px solid var\(--accent-hover\)/,
    );
  });
});
