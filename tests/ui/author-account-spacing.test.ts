// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

// 使用完整样式表检查级联；几何位置与真实 hover 视觉仍需浏览器验收。
it.each([false, true])(
  "账号入口 signed=%s 与导航保持同样内缩，文字不贴悬停底色",
  (signed) => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/styles/global.css", "utf8");
    document.head.appendChild(style);
    document.body.innerHTML = `<aside class="studio-sidebar"><nav class="studio-nav"><a href="/studio">文章</a></nav><div class="sidebar-bottom"><a class="site-link author-link${signed ? " signed" : ""}" href="/login">${signed ? '<span class="site-avatar">作</span><span class="author-account"><span class="author-account-name">很长的作者昵称</span><small>账号与退出</small></span>' : "管理员账号登录"}</a></div></aside>`;
    const account = getComputedStyle(document.querySelector(".author-link")!);
    const nav = getComputedStyle(document.querySelector(".studio-nav a")!);
    expect(account.paddingLeft).toBe(nav.paddingLeft);
    expect(account.paddingRight).toBe(nav.paddingRight);
    expect(account.gap).toBe(nav.gap);
    expect(account.fontSize).toBe(nav.fontSize);
    expect(account.borderRadius).toBe(nav.borderRadius);
    expect(parseFloat(account.paddingTop)).toBeGreaterThan(0);
    expect(parseFloat(account.paddingBottom)).toBeGreaterThan(0);
    expect(account.boxSizing).toBe("border-box");
    expect(account.minHeight).toBe("44px");
    // 只修账号内边距，不删除原来的主题悬停反馈或键盘焦点规则。
    expect(style.textContent).toMatch(
      /\.author-link:hover\s*\{\s*background: var\(--soft\)/,
    );
    expect(style.textContent).toContain(":focus-visible");
  },
);
