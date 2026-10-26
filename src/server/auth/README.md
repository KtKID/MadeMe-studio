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
