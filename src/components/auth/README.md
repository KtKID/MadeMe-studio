# 作者登录界面

## 边界

- `LoginPanel.tsx`：独立单作者 Google / 邮箱密码表单及显式退出，不开放注册。
- `client.ts`：同源 POST 与共享 Zod 协议校验。密码不进入 React 状态、日志、URL 或浏览器存储；提交立即清空输入。
- `/login` 服务端通过 `getAuthPresentation` 只下发 `mode/configured/authenticated`，作者本人已登录时再附带 `account`（账号邮箱，显示为“已登录：…”）；不下发配置、哈希、密钥或 Cookie。
- `AUTH_MODE=sites` 保留平台 SSO，不要求第二遍密码；独立 `password` / `google` 模式缺配置时明确不可用。
- 登录成功使用共享 `safeReturnTo` 再次清洗服务端回跳地址。失败只显示固定中文提示，不能回显服务器内部错误。
- Studio 的账号入口是完整导航链接；设置/编辑未保存保护先处理离开，再进入账号页。退出不是导航副作用，必须点击并确认后 POST。

- 独立模式非 HTTPS 页面不渲染密码字段；水合前字段禁用，表单显式 POST，防止脚本失败时凭据落入 URL。

## Google 单作者登录

- `AUTH_MODE=google` 使用原生表单 `POST /api/auth/google/start`，隐藏字段 `returnTo` 经过共享 `safeReturnTo` 清洗；无 JavaScript 仍可登录，不通过 fetch 追随跨域 OAuth 重定向。
- HTTPS 或服务端配置门控不通过时不渲染登录表单；只显示配置状态，不能展示作者邮箱、Client Secret 或 OAuth 令牌。
- 页面只下发允许的 `google_denied/google_failed` 错误码，分别显示固定授权拒绝/未完成提示；非作者、取消授权不暴露白名单身份。不提供注册。
- 首次提交交给浏览器原生导航，同帧重复提交阻止；浏览器返回触发 `pageshow` 时恢复按钮。实际 Google 授权与服务端令牌校验不由组件完成。
- 已认证后复用显式确认退出 `POST /api/auth/logout`；无脚本时退出按钮保持禁用并提示启用 JavaScript。
- Studio 账号入口对 password/google 显示；默认 Sites 预览不因此变更模式。未登录显示用户线条图标与“管理员账号登录”；已登录显示首字母头像、账号名（Google 昵称优先，回退邮箱；过长省略，悬停 title 显示“昵称（邮箱）”）与“账号与退出”小字。`StudioShell` 在身份失效后立即隐藏账号名。

## 可访问性与状态

原生 email/password 表单具有关联标签和自动填充语义；忙碌时禁用字段和提交，使用 ref 防重复请求；错误通过 alert 告知并聚焦密码框，允许重新输入重试。不提供找回密码或注册流程。

## 测试

- `tests/ui/google-auth-clicks.test.tsx`：真实组件 DOM + React 服务端输出；覆盖同源原生 POST、无脚本可提交、危险回跳、重复提交、返回恢复、失败/取消提示、配置/HTTPS 门控、退出取消与失败。fetch 边界模拟，不声称已通过真实 Google OAuth 或浏览器 E2E。

- `tests/unit/author-login-ui.test.ts`：协议、同源请求、跳转清洗、错误脱敏、模式渲染、显式退出回执。
- `tests/e2e/author-login.spec.ts`：部署模式、延迟失败/清空/重试状态及真实独立认证登录退出。
- E2E 源码不等于已通过浏览器验收。独立模式测试需要隔离部署，真实凭据由验收者经环境变量 `E2E_AUTHOR_EMAIL/E2E_AUTHOR_PASSWORD` 提供，不能提交仓库或开启凭据追踪录像；条件不足明确跳过。

账号入口保持现有主题 hover 与键盘 focus 反馈；内部横向 13px 与导航入口一致，纵向 11px 留白，并与导航共用 12px 图文间距与字号，避免未登录文字或已登录头像贴着背景边缘。对应完整 CSS 级联回归见 `tests/ui/author-account-spacing.test.ts`；该测试不替代真实浏览器几何验收。
