# 设计系统

`global.css` 使用独立设计 tokens：

- `data-skin`：amber（默认暖黄）、sage、rose、ocean、mono，只影响色相。
- `data-mode`：light、dark、system，只影响表面/文字/边框明度。
- `data-font`：yahei（默认）、sans、serif、mono，只影响字栈。

默认字体使用系统 `'Microsoft YaHei','微软雅黑','PingFang SC',system-ui,sans-serif`，不打包或下载商业字体。前端启动时监听系统明暗变化，未启用 JavaScript 时仍有 CSS `prefers-color-scheme` 回退。

断点：1200、960、680 px。工作台移动端改为顶栏，编辑器工具条吸顶，长表格与代码允许自身滚动，主页面不能横向溢出。

测试：`tests/appearance.test.ts` 固定维度解耦；浏览器截图和移动端溢出检查属于 E2E 验收。

公开首页与文章页的 `.public-shell` 使用最小视口高度与纵向 flex，直属 main 伸展填空，header/footer 不收缩：短页页脚落在视口底部，长页随正文自然向下，不用 fixed/absolute 遮挡内容。`100vh` 作为回退、`100dvh` 适配移动视口；工作台已有独立 flex 框架，不额外改写。`tests/ui/footer-layout.test.ts` 验证实际 CSS 契约，真实几何和移动视口需浏览器验收。

`.obsidian-directory-control` 仅用于预设文章子目录：复用 `button-group` 的 8px 间距和换行，input 伸展、按钮 `flex:0 0 auto`，窄列自然换行；不覆盖其它表单或按钮。
