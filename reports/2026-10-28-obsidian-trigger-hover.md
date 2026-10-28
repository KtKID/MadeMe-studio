# 2026-10-28：仅取消“保存到 Obsidian”文字入口灰色悬停背景

用户要求取消编辑器顶部该文字入口的灰色悬停底色。已查看用户截图。

## 原因与修复范围

入口复用 `.button` 后，`.button:hover` 的 specificity 高于 `.writing-shortcuts button`，所以通用 `background: var(--soft)` 覆盖快捷栏原有 `background: none`，形成灰色圆角底。

只给此入口增加 `obsidian-save-trigger` 标记，添加窄选择器 `.writing-shortcuts .obsidian-save-trigger:hover { background: transparent; }`。未修改全局按钮 hover、其它文字入口或弹窗按钮；未取消 `:focus-visible`，未改点击、busy、权限或保存逻辑，没有新增视觉设计。

## 验证

先新增样式作用域及唯一入口标记回归，观察2项失败；实现后通过。测试同时保留通用按钮 hover 与键盘 focus-visible 规则断言。

全仓80文件637项通过；check无errors/warnings、5条提示；build、HTTP冒烟通过。CSS/DOM契约测试不冒充真实浏览器hover截图验收。未推送或部署。
