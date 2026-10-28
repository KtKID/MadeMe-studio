import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ProductCredit from "../src/components/shared/ProductCredit";
import { PRODUCT_VERSION } from "../src/modules/config/product.ts";
import { runtimeConfigPatchSchema } from "../src/modules/config/schema.ts";

const read = (path: string) => readFileSync(path, "utf8");
describe("统一产品页脚", () => {
  it("SSR 署名从发布配置读取0.5版本，不改变作者可调协议", () => {
    expect(PRODUCT_VERSION).toBe("0.5");
    expect(renderToStaticMarkup(<ProductCredit />)).toContain(
      `Powered by MadeMe · v${PRODUCT_VERSION}`,
    );
    expect(runtimeConfigPatchSchema.safeParse({ version: "9.9" }).success).toBe(
      false,
    );
    expect(read("src/components/shared/ProductCredit.tsx")).not.toContain(
      '"0.5"',
    );
  });
  it("博客首页、文章页、两套后台页脚都使用同一个署名组件", () => {
    for (const file of [
      "src/pages/index.astro",
      "src/pages/p/[slug].astro",
      "src/layouts/Studio.astro",
      "src/components/studio/StudioShell.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("<ProductCredit />");
      expect(source).not.toContain("Made with intention");
    }
  });
  it("后台署名居中，公开页等宽边列保证居中且手机不隐藏版本", () => {
    const css = read("src/styles/global.css");
    expect(css).toMatch(/\.studio-footer \{[^}]*justify-content: center/);
    expect(css).toMatch(
      /\.public-footer \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
    );
    expect(css).not.toMatch(
      /\.public-footer > span:nth-child\(2\)\s*\{\s*display: none/,
    );
    expect(css).toMatch(
      /\.studio-footer \{[^}]*min-height: var\(--studio-footer-height\)/,
    );
  });
});
