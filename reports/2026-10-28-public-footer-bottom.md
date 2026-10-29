# 公开页短内容页脚底部布局（2026-10-28）

用户反馈公开页内容少时版权、产品署名与 RSS 整行上浮。

## 原因与修复

公开首页、文章阅读页共用 `.public-shell`，原来只有宽度与水平 margin，没有视口最小高度或正文伸展；页脚因此直接跟随短正文。后台两套框架已有最小高度和 flex，未发现相同样式缺口，不重复覆盖。

仅为 `.public-shell` 增加 `min-height:100vh` / `100dvh`、纵向 flex，直属 main 用 `flex:1 0 auto`，header/footer 不收缩。短页由正文区域填满剩余空间；长页使用 min-height 而非固定高度，自然随内容增长。页脚不 fixed/absolute，不改变字体、横向对齐、padding、内容或业务交互。

影响公开首页及文章页面，包括文章不存在/锁定态的同一布局。后台页脚保持原样；登录页没有该页脚，不增加新页脚。

## 先红后绿

`vitest run tests/ui/footer-layout.test.ts`：修改 CSS 前 3 failed / 1 passed（公开页缺少 flex/不收缩契约，后台通过），记录 `/tmp/footer-layout-red.log`；修改后 4 passed，记录 `/tmp/footer-layout-green.log`。

- 全仓：83 文件 / 676 项通过。
- check：241 文件，0 errors / 0 warnings / 5 既有 hints。
- build / HTTP smoke：通过。

这是加载完整 CSS 后的 computed style 契约，不把 jsdom 当真实布局引擎。短长页实际视口/手机几何由独立云预览浏览器验收。未推送 GitHub、未部署正式站；仅同步独立预览源码交父任务发布。
