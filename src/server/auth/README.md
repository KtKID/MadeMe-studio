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
- `POST /api/auth/logout` 撤销 D1 中当前会话并清空 Cookie；`GET /api/auth/session` 仅返回 `{mode,configured,authenticated}`。
- 登录和退出都强制 HTTPS、同源 Origin、Fetch Metadata；Bearer 不能豁免这两个端点的 CSRF 检查。普通 API 中 Bearer 始终覆盖 Cookie 身份，不能获得作者权限。
- Cookie 为 `__Host-mm_author`，固定 Path=/，Secure、HttpOnly、SameSite=Strict，不设置 Domain。D1 只保存 256 位随机令牌的 SHA-256 摘要。重新登录原子撤销当前旧会话并颁发新令牌；8 小时绝对过期，无滑动延长。第一版尚不提供独立空闲超时策略。可直接撤销 `author_sessions.revoked_at`，邮箱、密码摘要或 SESSION_SECRET 变更也会使所有旧会话失效。
- 登录在 KDF 前以 D1 执行全局单作者每 5 分钟最多 5 次尝试限制，不信任请求 IP 或邮箱作为限流键。此策略防止伪造 IP/换邮箱绕过，但攻击者也可能消耗窗口造成短时拒绝服务；独立生产发布前应结合可信边缘 WAF/访问限制评估可用性，不能通过信任任意客户端头修复。
- 新部署执行追加迁移 `drizzle/0002_author_sessions.sql`；不更改已部署初始迁移。仅独立模式登录/后台 HTML 增加 `frame-ancestors 'none'`，保留 Sites 的 iframe 兼容。

### 哈希与运行平台限制

作者密码使用随机 16 字节盐和标准 PBKDF2-HMAC-SHA256 600,000 次迭代，格式 `pbkdf2-sha256:600000:<salt hex>:<hash hex>`。遵循 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) 的 PBKDF2 建议；不复用文章密码的旧兼容格式，不自动降级迭代数。

**当前不能声称生产 Cloudflare Workers 可用。** [Cloudflare workerd 官方 issue #1346](https://github.com/cloudflare/workerd/issues/1346) 和 [PR #7550](https://github.com/cloudflare/workerd/pull/7550) 记录生产迭代上限与本地运行时行为差异。本地 Node/隔离 workerd 通过不是生产支持证明。平台拒绝标准工作因子时返回 `503 AUTH_KDF_UNAVAILABLE`，不创建会话、不尝试较弱参数。`configured` 只报告配置结构就绪，不是平台 KDF 可运行证明。独立部署选择、目标运行时验证和真实凭据配置仍须完成后才能启用；目前线上保持 Sites 模式。

测试：`tests/backend/author-auth.test.ts` 覆盖安全 Cookie、登录轮换、撤销/过期、配置轮换、无用户枚举、持久化限流、CSRF、Bearer 权限隔离、伪造头与开发旁路、畸形配置、输入边界和 KDF 失败关闭。测试凭据仅在隔离内存数据库中生成，不配置真实环境。
