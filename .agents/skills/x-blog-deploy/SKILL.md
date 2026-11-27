---
name: x-blog-deploy
description: 将 MadeMe-studio（blog.ktkid.ai）部署到 Cloudflare，或核对 Worker、D1、R2 等资源分别存放什么时使用。
---
# 将 MadeMe 博客部署到 Cloudflare

适用于 [KtKID/MadeMe-studio](https://github.com/KtKID/MadeMe-studio)。更完整的历史约定见仓库 [docs/DEPLOYMENT.md](https://github.com/KtKID/MadeMe-studio/blob/main/docs/DEPLOYMENT.md)。本 skill 只讲生产站 `blog.ktkid.ai` 的 Cloudflare 部署与资源存放位置；不要和 Sites 私有预览、本地开发实例混在一起。

未获仓库所有者明确确认，不要合并到 `main`、不要触发生产发布、不要对远程 D1 做迁移，也不要在本机对生产执行 `wrangler deploy` 或 `npm run deploy:production`。

## 资源放在哪

生产跑在已有 Cloudflare Worker 上，不新建 Worker，也不连接 Cloudflare Workers Builds。绑定见 `wrangler.jsonc` 的 `env.production`；默认环境里的 D1 ID 是本地占位符，不要用它发布。

| 资源 | 名称 / 位置 | 绑定 | 放什么 |
| --- | --- | --- | --- |
| Worker | `author-studio`（不要建 `author-studio-production`） | 本身 | Astro 服务端渲染、API、认证与业务逻辑。入口是构建产物 `dist/server`（发布用 `dist/server/wrangler.json` 的 `entry.mjs`，`no_bundle: true`）。 |
| 自定义域 | `blog.ktkid.ai` | 控制台管理 | 生产访问域名。部署脚本不改 Routes、自定义域或 `workers.dev`，以保留现有访问设置。 |
| 静态资产 | 构建产物 `dist/client` | `ASSETS` | 前端 JS/CSS/静态页面等。HTML 为 `private, no-store`；`/_astro/*.js` 为长期 immutable 缓存（发布后带新 hash）。 |
| D1 | `author-studio`，ID `c2758015-872a-454b-8915-68a8a662040c` | `DB` | 结构化业务数据，见下表。`drizzle/` 只有结构迁移，没有作者、文章或密钥种子。 |
| R2 桶 | `author-studio-media` | `BUCKET` | 媒体二进制，见下文对象键。元数据在 D1，不在桶里。 |
| Cloudflare 账户 | 构建用公开账户 ID `aa31bc6b12b747b89ccb446e43aef6c4` | — | 运行时 `CLOUDFLARE_ACCOUNT_ID` secret 是另一条配置渠道，不要读取该 secret 来借部署授权。 |

兼容日期 `2026-10-01`，开启 `nodejs_compat`。`keep_vars: true` 保留控制台里已有的普通变量；它不保护路由。切流量时只传 Worker 名称，不要用完整生成配置覆盖 observability 等控制台设置。

### D1 里放什么

| 表 | 内容 |
| --- | --- |
| `posts` | 文章草稿与已发布快照 |
| `revisions` | 修订历史 |
| `settings` | 站点设置；作者改过的限额等在 `document_json.limits` |
| `media` | 媒体元信息（含 `object_key`，指向 R2） |
| `api_tokens` | 外部发布 Token 摘要（不存明文） |
| `rate_limits` | 限流窗口 |
| `author_sessions` | 作者会话 |
| `google_auth_flows` / `google_author_sessions` | Google 登录临时流程与会话（可含 `display_name`） |
| `page_view_events` | 页面浏览统计 |

口令哈希和令牌摘要只在服务端表里，不进入公开文章协议。迁移不创建账户、不自动认领拥有者、不写示例文章。

### R2 桶里放什么

桶名 `author-studio-media`，只存媒体二进制：

- `media/<id>.webp`：静态 PNG/JPEG/WebP 上传后按 EXIF 转正、缩到最大宽 960 并转 WebP 的落库对象
- `media/<id>`：GIF/动画、音视频、文档等原样保存
- `image-derivatives/v1/<id>/`：展示用衍生图与 manifest（含旧路径与 `s1/` 子目录）

不要把文章正文、设置 JSON、令牌、日志或源码放进这个桶。文件 URL 只暴露不可预测的媒体 ID；`/api/files` 与音视频应使用 `private, no-store`，不要整桶改成公开缓存。

### 不放在 Cloudflare 上的东西

- **Git 仓库**在 GitHub：`KtKID/MadeMe-studio`，生产分支是 `main`。
- **Obsidian 库文件**仍在作者本机；服务器不存 vault 路径，也不存笔记原文件。
- **浏览器 IndexedDB**（目录授权句柄、导出预设、旧库兼容迁移）只在访问者当前浏览器与域名下，不上传、不清理为发布手段。
- **密钥与运行变量**在 Cloudflare 控制台（及本地 `.dev.vars`），不写入源码、构建产物、聊天或日志。
- **客户端 `clientLog`** 只写浏览器控制台（`[mademe]`），不发送到服务器。

### 运行时变量与 Secret（B 层，控制台管理）

部署脚本不写入、不复制、不删除运行变量或 secret；Wrangler 默认继承已有项。不要打印它们的值。设置页「账号与安全」底部的部署信息卡片只读显示「已配置 / 未配置」。

普通变量例子：`APP_ORIGIN`、`AUTH_MODE`、`ENVIRONMENT`、`GOOGLE_CLIENT_ID`、`OWNER_EMAIL`。Secret 例子：`SESSION_SECRET`、`GOOGLE_CLIENT_SECRET`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_AI_TOKEN`，以及按需配置的 AI 提供商密钥。产品页脚版本 `PRODUCT_VERSION` 是代码常量（C 层），不存 D1，也不与 npm 包版本绑定；页脚没变不等于站点没更新。

## 正式生产怎么发布

唯一正式通道：本仓库 `main` 的 GitHub Actions。`ci.yml` 在 `test` 成功后调用 [deploy-production.yml](https://github.com/KtKID/MadeMe-studio/blob/main/.github/workflows/deploy-production.yml)，最终执行 `npm run deploy:production`。

1. **先要所有者明确点头**合并并发布。不要因为 CI 绿、云端代理或审查意见而自行发布。
2. **只发布本仓库 `main` 当前尖端。**触发是对 `main` 的 `push`，或在 `main` 上手动 `workflow_dispatch`。PR、fork、tag、其它分支或仓库都不能发布；PR 上的 `deploy` job 会 `skipped`，这是预期行为。
3. **不要把普通 CI 测试通过当成已发布。**PR/推送的 `test` 不跑发布用的 build / smoke / worker / `verify:production`。发布 job 会重新精确 checkout 该 SHA，再跑：本地 build → `test:smoke` → `test:worker` → `CLOUDFLARE_ENV=production` 的生产 build → `verify:production` → 上传并切流量。任一步失败都不进入发布。
4. **构建时必须带 `CLOUDFLARE_ENV=production`。**不要先按默认环境构建，再只给部署命令补 `--env production`。Node 24，按锁文件 `npm ci`，不要提交锁文件以外的依赖变更。
5. **发布脚本做什么：**校验 `GITHUB_ACTIONS=true`、仓库、`refs/heads/main`、事件类型和完整 SHA；用只读 GitHub API 再核对当前 `main`（过时则停）；`wrangler versions upload` 到已有 Worker，带该提交 SHA 作 tag；从官方 NDJSON 取本次唯一 `version-upload` UUID，再 `wrangler versions deploy <UUID>@100%`。不按 `latest` 猜、不创建 Worker、不调用普通 `wrangler deploy`（会动路由）、不应用数据库迁移、失败不自动重试。
6. **发布后核验线上。**看 Actions 里 `deploy / release` 是否 success；再抓取 `https://blog.ktkid.ai/` 与相关页面，确认 HTML 引入的 `/_astro/*.js` hash 已换新，并在新脚本里核对本次改动的特征字符串。不要只凭页脚版本判断。

仓库 Actions Secret 名称是 `CLOUDFLARE_API_TOKEN_FOR_DEPLOY`，只在最后发布步骤注入为 `CLOUDFLARE_API_TOKEN`。Token 应仅有已有 Worker `author-studio` 的 Individual Workers Editor，不要为了发布去扩大到 D1/R2 编辑或路由权限。不要在聊天里要求或回显该值。

并发：部署工作流使用 `production-author-studio` concurrency，`cancel-in-progress: false`，避免发布中途被取消。不要同时用手工 Wrangler 或其它通道改生产配置。

## 远程迁移（与发布分开）

`npm run deploy:production` **不应用** D1 迁移。需要迁移时：先获得所有者明确授权；先 `wrangler d1 export --remote` 备份正式库；再对生产绑定 `DB` 应用迁移。若代码依赖新列，必须先迁移再部署读该列的代码。本地只能 `npx wrangler d1 migrations apply DB --local --config wrangler.jsonc`，从不 `--remote`，也从不 `--env production` 做日常开发迁移。

## 本地开发（不是生产发布）

1. Node 24，仓库根目录 `npm ci`。
2. 复制 `.env.example` 为 `.dev.vars`（已 gitignore，不要提交）。
3. `npx wrangler d1 migrations apply DB --local --config wrangler.jsonc` 后 `npm run dev`，只绑 `127.0.0.1`（默认 4321）。
4. 不要把开发身份或 `.dev.vars` 搬到生产，不要对公网开放开发实例。
5. `本地无凭据核对生产产物：` `CLOUDFLARE_ENV=production npm run build` 然后 `npm run verify:production`（`--dry-run`，不上传）。

## 故障与回滚

- 服务端日志在 Cloudflare 控制台 Workers → `author-studio` → Logs；或 `npx wrangler tail author-studio --format pretty`。转发前去掉 URL 查询串。
- 发布超时或异常不要盲目重试；先查控制台部署历史和 Actions 日志，确认是否已切流量。
- 回滚：在控制台把 Worker 切回上一个已知良好版本，或按所有者指定的旧提交再走正式发布流程。不要 force-push `main`。普通变量和 secret 由控制台继承保留，不是可恢复的配置备份。
