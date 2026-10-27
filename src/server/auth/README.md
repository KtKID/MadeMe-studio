# 身份与访问控制模块

## 信任边界

- 仅在显式 `AUTH_MODE=sites` 下读取可信分发器写入的 `oai-authenticated-user-id` 与邮箱头；其他模式忽略这些头。
- 该模式依赖上游清除外部同名头部，不能直接暴露可伪造头部的原始 Worker 公网入口。
- 拥有者由运行时 `OWNER_ID` 或 `OWNER_EMAIL` 明确绑定。邮箱绑定也必须同时存在稳定身份 ID；不存在“第一位访问者成为管理员”。
- 缺少拥有者配置、服务绕过请求没有身份、错误身份均无法写入。

## 授权

浏览器写请求必须带与请求 URL 相同的 Origin；跨站 Fetch Metadata 被拒绝。Bearer API Token 使用独立身份，仅允许已授予的 scope，不继承浏览器作者权限。设置、密钥元数据、AI 和令牌管理始终要求作者身份。

文章密码采用随机盐 PBKDF2-SHA256。解锁 Cookie 为 HMAC 签名、HttpOnly、SameSite=Strict，在 HTTPS 下使用 Secure。Cookie 同时绑定文章与已发布密码摘要，发布新密码后旧 Cookie 自动失效。草稿密码变化不影响已发布快照。

## 测试

`identity.test.ts` 覆盖配置缺失、伪造头、非作者、显式邮箱、ID 优先、本地开发限定、CSRF、scope、密码与设置脱敏；`http.e2e.test.ts` 覆盖真实请求下的解锁和撤销。

写权限不隐含读权限。没有 `posts:read` 的令牌执行创建、修改、删除、发布、撤回或恢复时只得到 `{id, version}` 回执；作者和具有读取 scope 的令牌才能得到完整文章。恢复已发布回收站内容还需要 `posts:publish`，防止借恢复绕过发布权限。

密码发布在 API 边界先检查 `SESSION_SECRET`：缺失或短于 32 字符时返回 `503 SESSION_SETUP_REQUIRED`，不会修改草稿版本、密码摘要或已发布快照；草稿已设为 password 且发布请求省略 visibility 时同样检查。公开/链接发布不依赖此密钥。`passwordConfigured` 能力仅向作者报告配置是否就绪，不含密钥值；该检查不在纯文章领域服务中混入运行时配置。

## 独立单作者模式（尚未配置真实部署凭据）

`AUTH_MODE=password` 独立于 Sites 信任头，无公众注册和第一访问者注册流程，也禁用本地开发身份旁路。必须同时配置 D1、合法 `OWNER_EMAIL`、`AUTH_PASSWORD_HASH` 和至少 32 字符的随机 `SESSION_SECRET`；缺失或畸形配置失败关闭。Sites 模式与已有文章密码 Cookie 不变，任何生产切换及真实凭据配置需要单独确认。

- `src/shared/auth.ts` 是登录请求、登录/退出/会话响应和站内 `returnTo` 校验的单一协议来源。
- `POST /api/auth/login` 接受 `{email,password,returnTo?}`；返回 `{ok:true,returnTo}`，不返回密码、邮箱配置、哈希或会话令牌正文。
- `POST /api/auth/logout` 撤销 D1 中当前会话并清空 Cookie；`GET /api/auth/session` 返回 `{mode,configured,authenticated}`；仅当当前请求本身已通过作者验证（password/google 模式）时额外返回 `account`（即配置的 `OWNER_EMAIL`，规范化小写），未登录、伪造身份头、Bearer 令牌均不返回。
- 登录和退出都强制 HTTPS、同源 Origin、Fetch Metadata；Bearer 不能豁免这两个端点的 CSRF 检查。普通 API 中 Bearer 始终覆盖 Cookie 身份，不能获得作者权限。
- Cookie 为 `__Host-mm_author`，固定 Path=/，Secure、HttpOnly、SameSite=Strict，不设置 Domain。D1 只保存 256 位随机令牌的 SHA-256 摘要。重新登录原子撤销当前旧会话并颁发新令牌；8 小时绝对过期，无滑动延长。第一版尚不提供独立空闲超时策略。可直接撤销 `author_sessions.revoked_at`，邮箱、密码摘要或 SESSION_SECRET 变更也会使所有旧会话失效。
- 登录在 KDF 前以 D1 执行全局单作者每 5 分钟最多 5 次尝试限制，不信任请求 IP 或邮箱作为限流键。此策略防止伪造 IP/换邮箱绕过，但攻击者也可能消耗窗口造成短时拒绝服务；独立生产发布前应结合可信边缘 WAF/访问限制评估可用性，不能通过信任任意客户端头修复。
- 新部署执行追加迁移 `drizzle/0002_author_sessions.sql`；不更改已部署初始迁移。仅独立模式登录/后台 HTML 增加 `frame-ancestors 'none'`，保留 Sites 的 iframe 兼容。

### 哈希与运行平台限制

作者密码使用随机 16 字节盐和标准 PBKDF2-HMAC-SHA256 600,000 次迭代，格式 `pbkdf2-sha256:600000:<salt hex>:<hash hex>`。遵循 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) 的 PBKDF2 建议；不复用文章密码的旧兼容格式，不自动降级迭代数。

**当前不能声称生产 Cloudflare Workers 可用。** [Cloudflare workerd 官方 issue #1346](https://github.com/cloudflare/workerd/issues/1346) 和 [PR #7550](https://github.com/cloudflare/workerd/pull/7550) 记录生产迭代上限与本地运行时行为差异。本地 Node/隔离 workerd 通过不是生产支持证明。平台拒绝标准工作因子时返回 `503 AUTH_KDF_UNAVAILABLE`，不创建会话、不尝试较弱参数。`configured` 只报告配置结构就绪，不是平台 KDF 可运行证明。独立部署选择、目标运行时验证和真实凭据配置仍须完成后才能启用；目前线上保持 Sites 模式。

测试：`tests/backend/author-auth.test.ts` 覆盖安全 Cookie、登录轮换、撤销/过期、配置轮换、无用户枚举、持久化限流、CSRF、Bearer 权限隔离、伪造头与开发旁路、畸形配置、输入边界和 KDF 失败关闭。测试凭据仅在隔离内存数据库中生成，不配置真实环境。

## Google 单作者模式（需独立完成部署配置）

`AUTH_MODE=google` 使用 Google OIDC authorization-code + PKCE S256，不使用 Sites 身份头、开发身份旁路或密码会话。访问者阅读无需 Google 登录；没有公众注册。`src/shared/auth.ts` 仍为协议单源。配置结构验证不代表真实 OAuth 已验收；本实现不能在缺少 OAuth 客户端与部署环境的情况下宣称上线可用。

必需配置：D1、固定 HTTPS `APP_ORIGIN`（仅 origin，不带路径和尾斜线）、Google Web OAuth `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、明确 `OWNER_EMAIL`、至少 32 字符随机 `SESSION_SECRET`。可选 `OWNER_GOOGLE_SUB` 进一步绑定 Google 稳定主体。第一版 Gmail 作者可仅用邮箱白名单；非 Gmail 邮箱必须同时提供 `OWNER_GOOGLE_SUB`，不把第三方邮箱的 `email_verified` 误当作 Google 持续掌握邮箱所有权的证明。所有实际值通过部署私有配置注入，不写仓库、不发聊天、不放前端。

- `POST /api/auth/google/start` 接收同源 HTTPS 的 `application/x-www-form-urlencoded` 表单，仅接受可选 `returnTo`。服务器生成 state、nonce、PKCE verifier；返回 303 Google 授权地址。固定 `openid email`，不申请 offline 或 profile 权限。
- 回调固定为 `${APP_ORIGIN}/api/auth/google/callback`，必须在 OAuth 客户端中登记完全一致的地址。只允许硬编码 Google token/JWKS HTTPS 端点；5 秒超时、64 KiB 响应上限、禁止网络重定向（Workers fetch 仅支持 `redirect: "follow" | "manual"`，传 `"error"` 会直接抛 TypeError；因此使用 `"manual"`，任何非 2xx 响应——含 3xx——均视为失败），不接受请求提供的 discovery URL 或 JWKS URL。
- `__Host-mm_google_oauth` 是 HttpOnly、Secure、SameSite=Lax 的浏览器绑定 Cookie。D1 临时流程十分钟有效；state 与 Cookie 均存摘要，PKCE verifier 只短暂存在流程表。`DELETE ... RETURNING` 原子单次消费，重复/并发回调不可再次换票；失败需重新开始登录。
- 使用 `jose` 验证 RS256 签名、Google issuer、audience、iat/exp、nonce、azp 和 verified email。JWT 自带的远程 key URL 不参与取钥。成功还必须满足预配置作者白名单/主体，绝不首次访问认领管理员。
- Google access token、refresh token、ID token 不落库，不返回前端；应用会话采用独立随机 opaque Cookie `__Host-mm_google_author`。D1 `google_author_sessions` 仅存 token SHA-256 摘要、配置指纹与时间；八小时绝对过期。重新登录撤销当前旧会话，退出服务端撤销；邮箱、主体、客户端 ID/secret、APP_ORIGIN、SESSION_SECRET 任何配置变化均使旧会话与待完成流程失效。
- `POST /api/auth/logout` 与所有浏览器写 API 保留同源 Origin/Fetch Metadata 检查；Google Cookie 不豁免 CSRF。Bearer API Token 保持现有显式 scope 授权，不继承 Google 作者权限。
- 回调错误仅跳到固定 `google_failed` / `google_denied`，不反射提供方错误、邮箱或授权码；Worker 日志经统一日志接口记录 `auth.google.callback_failed`，字段仅含 `requestId`/`path`、`stage`、`outcome`、异常类型与固定错误码（不含异常消息）；provider 请求失败另记 `auth.google.provider_failed`（端点名、HTTP 状态、是否超时）；`stage` 为固定标签 `flow`/`provider_error`/`code`/`token`/`jwks`/`verify`/`claims`/`binding`/`owner`/`session`，不记录 code、token、state、邮箱或提供方错误内容；`/api/auth/*`（含 start 的 303 跳转与携带 code/state 的回调）设置 no-referrer；`/login` 设置 same-origin，使同源原生表单 POST 携带真实 Origin（no-referrer 会让浏览器发送 `Origin: null` 而被同源校验拒绝），同时不向外站发送 Referer。认证入口配置错误返回 503，来源错误返回 403，未登录作者操作返回 401。
- 追加迁移 `0003_google_author_auth.sql`，不修改旧表/旧迁移。切换 AUTH_MODE 和创建真实凭据必须经过独立部署确认，不自动改变线上 Sites 模式。

测试入口 `tests/backend/google-auth.test.ts` 使用隔离 SQLite、真实 RSA 签名与模拟 Google 网络；不会访问真实 OAuth 账号。只有依赖安装及完整测试实际成功后，才能将本模块标记验收通过。

## 作者账号名展示

- `account.ts` 的 `ownerAccount(env, identity)` 是账号名的唯一来源：仅 `identity.owner` 且 `AUTH_MODE` 为 `google` / `password` 时返回 `OWNER_EMAIL`（trim + 小写，必须是合法邮箱），否则 `null`。Sites 与本地开发身份不返回账号名。
- 不新增 D1 字段：会话只会在登录邮箱与 `OWNER_EMAIL` 一致时颁发（Google 回调校验已验证邮箱，密码模式校验配置邮箱），所以配置值就是当前会话的账号。Google 显示名需要 `profile` scope 与新迁移，目前未启用（见 `reports/2026-10-27-studio-account-name.md`）。
- 使用方：`/api/auth/session` 与 `/login`（`getAuthPresentation`）、工作台 `loadStudioPageData` 与编辑器 `loadEditorPageData` 的 `account` 字段。账号名属于个人信息，只出现在作者本人的 no-store 响应/页面中，绝不写入日志。
- 测试：`tests/ui/author-account.test.tsx`（模式矩阵与侧边栏渲染）、`tests/backend/google-auth.test.ts`、`tests/backend/author-auth.test.ts`（会话形状、退出后消失、日志不含邮箱）。
