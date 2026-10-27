# 布局与主题模块

`Base.astro` 提供语义 HTML、语言、视口、站点主题与跳转主内容入口。`Studio.astro` 提供响应式工作台侧边栏、导航与统一页脚；可选 `account` / `accountName` 属性（来自 `loadEditorPageData`，昵称优先）用于在侧边栏账号入口显示作者账号名，与 `StudioShell` 保持相同标记和样式（`.author-link`、`.author-account-name`）。侧边栏底部只放账号入口（仅 password / google 模式渲染），站点链接统一用右上角“访问站点”；底部距离由 CSS 变量 `--sidebar-bottom-gap`（10px）控制，≤960px 时侧边栏变为顶部导航、账号入口隐藏。样式位于 `src/styles/global.css`。

强调色仅接受十六进制颜色，避免动态 CSS 注入。主题为 paper / ink / garden / mono，移动端需验证导航与表格不溢出。

## 后台导航性能

四个工作空间深链使用 `StudioWorkspace.astro` + 单个 React `StudioShell`。初次打开/刷新仍 SSR；同一已授权文档的四个业务模块保持挂载，hidden/inert 切换，不再每次切 tab 请求 HTML 与相同列表。编辑器、新建文章、登录及公开页保持完整导航。

设置链接与本document历史由明确的离开保护处理；取消history用go补偿，原生 beforeunload 保护刷新及完整导航。不可用 Astro before-preparation.preventDefault 冒充取消。

身份恢复、一次性secret与测量语义见 [会话导航](../modules/studio-navigation/README.md)。服务端 no-store、owner 权限校验不变，禁止把私有 HTML 设为公共缓存。
