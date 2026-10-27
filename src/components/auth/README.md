# 作者登录界面

## 边界

- `LoginPanel.tsx`：独立单作者邮箱密码表单及显式退出，不开放注册。
- `client.ts`：同源 POST 与共享 Zod 协议校验。密码不进入 React 状态、日志、URL 或浏览器存储；提交立即清空输入。
- `/login` 服务端通过 `getAuthPresentation` 只下发 `mode/configured/authenticated`，不下发配置、哈希、密钥或 Cookie。
- `AUTH_MODE=sites` 保留平台 SSO，不要求第二遍密码；独立 `password` 模式缺配置时明确不可用。
- 登录成功使用共享 `safeReturnTo` 再次清洗服务端回跳地址。失败只显示固定中文提示，不能回显服务器内部错误。
- Studio 的账号入口是完整导航链接；设置/编辑未保存保护先处理离开，再进入账号页。退出不是导航副作用，必须点击并确认后 POST。

- 独立模式非 HTTPS 页面不渲染密码字段；水合前字段禁用，表单显式 POST，防止脚本失败时凭据落入 URL。

## 可访问性与状态

原生 email/password 表单具有关联标签和自动填充语义；忙碌时禁用字段和提交，使用 ref 防重复请求；错误通过 alert 告知并聚焦密码框，允许重新输入重试。不提供找回密码或注册流程。

## 测试

- `tests/unit/author-login-ui.test.ts`：协议、同源请求、跳转清洗、错误脱敏、模式渲染、显式退出回执。
- `tests/e2e/author-login.spec.ts`：部署模式、延迟失败/清空/重试状态及真实独立认证登录退出。
- E2E 源码不等于已通过浏览器验收。独立模式测试需要隔离部署，真实凭据由验收者经环境变量 `E2E_AUTHOR_EMAIL/E2E_AUTHOR_PASSWORD` 提供，不能提交仓库或开启凭据追踪录像；条件不足明确跳过。
