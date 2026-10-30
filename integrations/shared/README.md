# Shared 客户端

`client.ts` 为 Chrome、Obsidian、agent CLI 复用的安全客户端。请求正文直接通过 `src/shared/contracts.ts` 的 Zod schema 校验，不另造 BlockNote JSON 协议。

请求带 `Accept: application/json; mademe-post-schema=2`（CORS 安全头，旧服务端忽略）；响应由容忍未知字段的 `postMutationResponseSchema` 解析，服务端新增字段（如 `coverSettings`）不会让客户端失败。客户端只建草稿和发布，不读后回写文章，因此不会丢失 `coverSettings`。

文章写入响应统一使用 `postMutationResponseSchema`：仅写 Token 获得 `{post:{id,version}}`，owner 或具备 `posts:read` 的 Token 可获得完整 Post。客户端不要求读取权限，不为了补充标题、正文或可见性再发 GET；对外摘要也不会复制完整响应中的私人内容。摘要 `visibility` 来自本次明确请求，完整响应若回显不同可见性则拒绝。

- `normalizeSiteUrl`：HTTPS 原点校验，固定 API 路径。
- `draftInput`：UTF-8 大小限制、换行规范化、草稿强制默认值。
- `createDraft` / `publishPost`：Bearer 认证、禁 Cookie/重定向、20 秒超时、错误不反射响应正文。
- `sourceUrl` / `clipMarkdown`：移除剪藏 URL 的 query/fragment，引用文本不当作 HTML 执行。

浏览器/Obsidian 由 esbuild 打包；CLI 使用 Node 原生 TS。此模块的单元测试在 `../tests/client.node.mjs`。HTTP Mock 测试并不等于真实部署端到端验证。
