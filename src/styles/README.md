# 设计系统

`global.css` 使用独立设计 tokens：

- `data-skin`：amber（默认暖黄）、sage、rose、ocean、mono，只影响色相。
- `data-mode`：light、dark、system，只影响表面/文字/边框明度。
- `data-font`：yahei（默认）、sans、serif、mono，只影响字栈。

默认字体使用系统 `'Microsoft YaHei','微软雅黑','PingFang SC',system-ui,sans-serif`，不打包或下载商业字体。前端启动时监听系统明暗变化，未启用 JavaScript 时仍有 CSS `prefers-color-scheme` 回退。

断点：1200、960、680 px。工作台移动端改为顶栏，编辑器工具条吸顶，长表格与代码允许自身滚动，主页面不能横向溢出。

测试：`tests/appearance.test.ts` 固定维度解耦；浏览器截图和移动端溢出检查属于 E2E 验收。
