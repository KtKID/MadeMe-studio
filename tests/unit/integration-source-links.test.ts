import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import Integrations from "../../src/components/integrations/Integrations";

describe("已交付集成源码入口", () => {
  it("安装、插件和指南全部指向 feat/v1，而非尚未发布的 main", () => {
    const html = renderToStaticMarkup(
      createElement(Integrations, { authenticated: false }),
    );
    for (const suffix of ["/chrome-clipper", "/obsidian-publisher", ""]) {
      expect(html).toContain(
        `href="https://github.com/KtKID/MadeMe-studio/tree/feat/v1/integrations${suffix}"`,
      );
    }
    expect(html).not.toContain("/tree/main/");
  });
});
