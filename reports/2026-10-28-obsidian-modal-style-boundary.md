# 2026-10-28：修复工具栏样式污染 Obsidian 保存弹窗

## 现象与可重复根因

用户截图显示弹窗主按钮文字在 hover 后消失、按钮文字贴边、内容边界异常。前一轮只检查 class 或单独修入口 hover，不足以覆盖嵌套后的真实 CSS cascade。

共享 Modal 当前原位渲染。Obsidian SaveButton 位于 `.writing-shortcuts` 内，其 Modal 也成为后代：

- `.writing-shortcuts button` 把弹窗按钮的 padding 改成 0、字号改成 10px。
- `.writing-shortcuts button:hover` 把文字改成 `var(--accent-hover)`；主按钮 hover 背景也是这个 token，导致前景/背景同色。
- 单靠添加 `.button` class 不能隔离广泛祖先选择器。

使用完整实际 `global.css` 的 DOM computed-style 测试已重复得到：修前主按钮 paddingTop 为 **0px**（应10px），hover 前景从 `var(--accent-ink)` 变为 `var(--accent-hover)`。这比只检查 class 更直接，但仍不是浏览器像素截图验收。

## 最小边界修复

1. 桌面、hover、移动端三处快捷栏规则全部收窄为 `.writing-shortcuts > button`，工具栏样式只处理直属按钮。
2. 无灰底入口规则同步限制为直属 `.obsidian-save-trigger`，保留用户要求；不取消弹窗按钮合理 hover。
3. **仅 Obsidian SaveButton 的 Modal** 使用 React portal 挂到 document.body，避免工具栏/编辑器祖先布局与样式影响。共享 `Modal` 源码及其他弹窗均不改，避免扩大交互影响。
4. 沿用现有 `.modal` padding（桌面26px/移动20px）、标题、按钮 padding/颜色和全局主题 token，没有逐个提高 specificity、没有新增补丁色值。

未改保存、权限、busy、共享 Modal 的焦点/Escape/遮罩逻辑；没有引入或更改共享 scroll-lock 行为。SSR 初始状态不访问 document，组件卸载清理仍由共享 Modal 既有生命周期完成。

## 验证与限制

- 3项cascade测试及1项portal结构/焦点测试先失败后通过；进一步覆盖light/dark、disabled opacity/cursor、focus-visible、标题字号、Modal水平/垂直padding、移动规则边界与SSR入口。
- jsdom无法真实悬停：测试仅将 `:hover` / `:focus-visible` 替换成相同specificity的测试类，使用全量CSS验证cascade，并明确不是真实鼠标截图。
- Obsidian实际组件测试覆盖portal位置、Tab焦点循环、Escape关闭、遮罩关闭、恢复入口焦点与卸载移除弹窗。
- 最终全仓 **82文件643项通过**；check **0 errors、0 warnings、5 hints**；build、HTTP冒烟通过。共享Modal其他既有测试在全仓回归中未出现失败。
- 已查看用户三张截图；修复后的真实支持浏览器 computed-style/视觉截图仍待获授权预览验证。没有绕过data URL策略或独立Chromium权限限制，不称视觉验收完成。

独立本地提交，未推送、合并或部署。
