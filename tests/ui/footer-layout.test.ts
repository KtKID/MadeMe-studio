// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = readFileSync("src/styles/global.css", "utf8");
  document.head.appendChild(style);
});
afterEach(() => {
  style.remove();
  document.body.replaceChildren();
});

// 验证真实CSS的伸展/自然流契约；jsdom不计算页面几何，实际视口验收另由浏览器完成。
it.each(["", "reading-main"])(
  "公开短页 %s 使用满视口纵向布局，让正文填满页脚之前的空白",
  (mainClass) => {
    document.body.innerHTML = `<div class="public-shell"><header class="public-header">导航</header><main class="${mainClass}">短内容</main><footer class="public-footer">页脚</footer></div>`;
    const shell = getComputedStyle(document.querySelector(".public-shell")!);
    const main = getComputedStyle(document.querySelector("main")!);
    expect(shell.display).toBe("flex");
    expect(shell.flexDirection).toBe("column");
    expect(["100vh", "100dvh"]).toContain(shell.minHeight);
    expect(main.flexGrow).toBe("1");
    expect(main.flexShrink).toBe("0");
  },
);

it.each(["public", "studio"])(
  "%s 长页页脚保持自然流，不fixed覆盖正文",
  (kind) => {
    document.body.innerHTML =
      kind === "public"
        ? '<div class="public-shell"><header class="public-header">导航</header><main>长内容</main><footer class="public-footer">页脚</footer></div>'
        : '<div class="studio-shell"><div class="studio-body"><header class="studio-topbar">导航</header><main class="studio-main">长内容</main><footer class="studio-footer">页脚</footer></div></div>';
    const footer = getComputedStyle(document.querySelector("footer")!);
    expect(["fixed", "absolute"]).not.toContain(footer.position);
    expect(footer.flexShrink).toBe("0");
    expect(
      getComputedStyle(document.querySelector(`.${kind}-shell`)!).height,
    ).not.toMatch(/100[vds]*vh/);
    if (kind === "studio") {
      expect(
        getComputedStyle(document.querySelector(".studio-body")!).flexDirection,
      ).toBe("column");
      expect(getComputedStyle(document.querySelector("main")!).flexGrow).toBe(
        "1",
      );
    }
  },
);
