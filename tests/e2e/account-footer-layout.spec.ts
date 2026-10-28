import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PRODUCT_VERSION } from "../../src/modules/config/product.ts";

// 独立布局夹具：真实样式表与两套布局共用的账号标记。
// 不验证真实认证，也不替代应用级导航测试。
const css = readFileSync("src/styles/global.css", "utf8");
// 静态校验夹具依赖的真实标记；组件变化时必须同步更新夹具。
for (const path of ["src/layouts/Studio.astro", "src/components/studio/StudioShell.tsx"]) {
  const source = readFileSync(path, "utf8");
  for (const token of ["sidebar-bottom", "author-link", "site-avatar", "author-account", "author-account-name", "账号与退出", "studio-footer"]) {
    if (!source.includes(token)) throw new Error(`${path} 缺少布局夹具所依赖的 ${token}`);
  }
}
for (const width of [1440, 1100, 961, 390]) {
  for (const mode of ["light", "dark"]) {
    test(`account footer ${width}px ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["KID", "VeryLongAuthorNameWithoutAnyBreaks@example.com"]) {
        await page.setContent(`<html data-mode="${mode}"><head><style>${css}</style></head><body>
          <div class="studio-shell"><aside class="studio-sidebar">
            <a class="brand" href="/studio">MadeMe</a>
            <a class="button primary new-post" href="/studio/new">写新文章</a><div class="nav-label">工作空间</div><nav class="studio-nav" aria-label="创作后台"><a href="/studio">所有文章</a><a href="/studio/media">媒体库</a><a href="/studio/settings">站点设置</a><a href="/studio/integrations">连接与发布</a></nav>
            <div class="sidebar-bottom"><a class="site-link author-link signed" href="/login?returnTo=%2Fstudio">
              <span class="site-avatar" aria-hidden="true">K</span><span class="author-account">
                <span class="author-account-name">${name}</span><small>账号与退出</small>
              </span></a></div></aside>
            <div class="studio-body"><main class="studio-main"></main>
              <footer class="studio-footer"><span class="product-credit">Powered by MadeMe · v${PRODUCT_VERSION}</span></footer>
            </div></div></body></html>`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        if (width <= 960) {
          await expect(page.locator(".sidebar-bottom")).toBeHidden();
          continue;
        }
        const geometry = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          const bottom = rect(".sidebar-bottom"), footer = rect(".studio-footer"),
            avatar = rect(".site-avatar"), name = rect(".author-account-name"), action = rect(".author-account small");
          return { topDifference: bottom.top - footer.top, height: bottom.height,
            footerHeight: footer.height, centerDifference: avatar.y + avatar.height / 2 - (footer.y + footer.height / 2),
            textDifference: name.y + name.height / 2 - (action.y + action.height / 2),
            actionFits: action.right <= bottom.right, nameWidth: name.width };
        });
        expect(Math.abs(geometry.topDifference)).toBeLessThanOrEqual(1);
        expect(geometry.height).toBe(56);
        expect(geometry.footerHeight).toBe(56);
        expect(Math.abs(geometry.centerDifference)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.textDifference)).toBeLessThanOrEqual(1);
        expect(geometry.actionFits).toBe(true);
        expect(geometry.nameWidth).toBeGreaterThan(0);
        await page.locator(".author-link").focus();
        await expect(page.locator(".author-link")).toBeFocused();
        // 长页面仍按原逻辑滚动，不把右页脚固定后遮挡内容。
        await page.locator(".studio-main").evaluate((element) => { element.style.minHeight = "1400px"; });
        expect(await page.locator(".studio-footer").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(900);
        await page.locator(".studio-main").evaluate((element) => { element.style.minHeight = ""; });
        await page.setViewportSize({ width, height: 320 });
        const navigationClear = await page.evaluate(() =>
          document.querySelector(".studio-nav")!.getBoundingClientRect().bottom <=
          document.querySelector(".sidebar-bottom")!.getBoundingClientRect().top,
        );
        expect(navigationClear).toBe(true);
        await page.locator(".author-link").scrollIntoViewIfNeeded();
        expect(await page.locator(".author-link").evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        })).toBe(true);
        await page.setViewportSize({ width, height: 900 });
      }
    });
  }
}
