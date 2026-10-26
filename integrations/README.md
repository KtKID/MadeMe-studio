# 外部发布集成

所有入口都默认创建 **private draft（草稿）**。不会自动安装扩展、扫描 Obsidian 仓库、创建真实 Token 或发布公开文章。

| 模块 | 说明 |
| --- | --- |
| [shared](shared/README.md) | 复用主应用 Zod 协议的客户端、安全边界 |
| [chrome-clipper](chrome-clipper/README.md) | MV3 选区剪藏，先预览后保存 |
| [obsidian-publisher](obsidian-publisher/README.md) | 仅当前笔记，明确确认后发送 |
| [agent-publisher](agent-publisher/README.md) | 单文件 CLI 与 agent skill |
| [tests](tests/README.md) | 单元、CLI 冒烟、人工端到端检查表 |

## 共同约定

- 从 Studio → Integrations 创建仅含 `posts:write` 的短有效期 Token；在各工具自己的设置中输入，不要写入仓库或日志。
- 请求：`POST /api/posts`，`Authorization: Bearer <token>`，正文 `{title, markdown, visibility:"draft"}`。服务端将 Markdown 转成 BlockNote JSON；集成不维护另一套区块格式。
- 仅写 Token 的响应是 `{post:{id,version}}`，无正文、标题等私密元数据；统一通过共享 Zod `postMutationResponseSchema` 验证。工具摘要的 `visibility` 来自本次明确请求，不为补充数据发起文章读取，也不要求扩大为 `posts:read`。
- 独立发布：`POST /api/posts/:id/publish`，正文 `{version, visibility:"public"|"unlisted"}`，需要 `posts:publish`。Chrome 和 Obsidian 不提供公开发布按钮；请在 Studio 审阅后发布。
- 只允许 HTTPS 站点原点；开发例外仅 `http://localhost` / `http://127.0.0.1`。拒绝凭据、路径、query 和 fragment；不跟随重定向，不携带 Cookie。
- 每次最多 512 KiB Markdown。附件、双链目标、其他笔记、远程页面不会自动抓取或上传；Markdown 的图片 URL 在文章阅读时仍可能产生外部请求，请审阅。
- 超时不等于服务端失败；不会自动重试非幂等创建。先去 Studio 检查，避免重复草稿。

## 验证入口

在仓库根目录运行：

```sh
node --test integrations/tests/*.node.mjs
node integrations/chrome-clipper/build.mjs
node integrations/obsidian-publisher/esbuild.config.mjs
node integrations/agent-publisher/publish.mjs --help
```

Node CLI / 测试要求 Node 22.18+（原生 TypeScript 类型擦除）以及根目录依赖已安装。Obsidian 的完整类型检查使用模块内官方 SDK 依赖，见该模块 README。

已验证：首轮 15 项单元/CLI 冒烟/本地 HTTP 协议 E2E 通过；最小写入回执安全更新先补 4 项回归并确认旧客户端失败，再实现共同协议适配，现共 **19 项全部通过**。Chrome 与 Obsidian 重新打包通过，shared strict tsc 与 Obsidian 官方 SDK 完整类型检查通过。真实 API 的操作步骤见 [LIVE_API_E2E.md](tests/LIVE_API_E2E.md)；未在真实用户站点写入、安装扩展或访问私人 vault。

开发顺序如实记录：shared 与 Chrome 的首版实现先于本目录测试；新增要求后先补测试和说明，再实现 CLI 与 Obsidian。不能将前者声称为严格 TDD。真实浏览器/Obsidian/已部署 Token 联调必须按 [检查表](tests/README.md) 另行验证。
