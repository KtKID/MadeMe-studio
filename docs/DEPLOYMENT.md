# 部署与本地运行

## 运行结构

Astro 服务端渲染及 API 运行于 Cloudflare Worker；D1 绑定名为 `DB`，R2 绑定名为 `BUCKET`。`wrangler.jsonc` 中的数据库 ID 是本地占位符，不能直接当成生产资源。`drizzle/` 仅包含结构迁移，不包含作者、文章或密钥种子数据。

生产构建生成 `dist/client` 静态资产及 `dist/server` Worker；`scripts/package-worker.mjs` 创建托管兼容入口，同时保留 Astro 原始入口。`.openai/hosting.json` 声明绑定，不应保存凭据。

## 本地开发

1. 使用 Node.js 24，在仓库根目录执行 `npm ci`。
2. 复制 `.env.example` 为 `.dev.vars`，仅用于本地隔离实例。该文件已被 Git 忽略，不能提交。
3. 应用本地迁移：

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run dev
```

默认开发服务只绑定 `127.0.0.1`。示例中的测试身份仅在回环地址、`ENVIRONMENT=development`、显式允许开发身份且作者 ID 匹配时生效。不要对公网开放开发实例，也不要将开发身份配置复制到生产。

`npm run build` 只构建，不会替生产数据库应用迁移。真实 Worker 冒烟和 HTTP E2E 均自动创建全新临时 D1/R2、应用迁移并启动测试进程，结束后清理。先完成构建，再串行运行 `npm run test:smoke` 与 `npm run test:worker`，预留回环端口 4321/4322；无需提前启动开发服务。详见 [Worker 测试](../tests/worker/README.md)。浏览器用例另需可用浏览器与隔离应用实例，配置方式见 `playwright.config.ts` 和测试目录说明。

## Sites 私有部署

当前预览保持仅授权用户访问，未公开发布。访问者先经过托管层 ChatGPT 登录门；登录门成功呈现不等于内部所有应用功能验收完成。

部署必须确认：

- D1 与 R2 已正确绑定。Sites 托管发布流程会在上传 Worker 前应用托管迁移；检查发布结果，不要求用户重复手工执行。其他部署目标仍需按各自受支持的数据库流程应用迁移并记录结果。
- `AUTH_MODE=sites`，并明确绑定 `OWNER_ID`，或绑定可信拥有者的 `OWNER_EMAIL`。配置作者身份不意味着任意第一个登录者成为作者。
- 上游身份分发器清除客户端伪造的同名身份头；不能把仅信任头部的原始 Worker 公网入口直接暴露。
- `OWNER_ID` 优先于邮箱，没有匹配时不会回退认领。
- 环境值通过托管平台安全配置，不放入源码、构建压缩包、客户端或日志。

正式迁移前先备份现有数据库并确认目标，不能将本地测试数据或私人笔记当作部署种子。当前测试不替代正式环境的迁移、备份恢复与运维检查。

## 密码文章

通过安全运行时配置提供至少 32 字符的 `SESSION_SECRET`。不要使用文档示例、公开字符串或开发占位值作为真实密钥。未配置时公开/链接文章仍可发布，密码发布明确返回配置错误，不能悄悄降级为公开。

本轮预览没有配置此密钥；未创建持久凭据。之后设置或轮换应通过受控配置流程完成，不能把值发到项目 Issue 或提交记录。

## AI 提供商

按实际使用的提供商配置对应值，而不是同时填满所有项：

- `OPENAI_API_KEY`；图像可选独立 `IMAGE_API_KEY`。
- `OPENROUTER_API_KEY`。
- `SILICONFLOW_API_KEY`。
- `GEMINI_API_KEY`。
- `CLOUDFLARE_AI_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。

可选 `IMAGE_MODEL` 为图像模型默认值。文本与图片模型分别选择；账户权限、模型可用性与费用由提供商决定。设置面板只保存模型/提示词等元数据，不采集密钥。客户端不接受任意 base URL。

`SILICONFLOW_IMAGE_HOSTS` 如确有需要，须由管理员补充已核验的精确 HTTPS 下载主机；不要添加通配符、本地域名、IP 或未核验地址来消除下载报错。具体约束见 [AI 模块](../src/server/ai/README.md)。

当前未使用真实凭据联调，无配置时返回明确错误，不会生成假文本或占位图片冒充成功。

## 外部发布接入

Chrome、Obsidian 与 CLI 使用短有效期、最小 scope 的 API Token。真实 Token 由作者在工作台明确创建并仅显示一次；源码不预置令牌。它与托管平台的登录会话不同。

私有 Sites 外层访问门可能先于应用 Bearer 鉴权拦截外部客户端。不要为了联调擅自公开站点或绕过身份门；先确认正式托管的受支持 API 访问方式，再按 [集成检查表](../integrations/tests/README.md) 验证。默认只创建草稿，正式发布需独立权限及明确操作。

## 日志与排障

服务端日志为单行 JSON（`level`、`event`、`ts`、`requestId`、`path` 及脱敏字段），见 [日志模块](../src/modules/log/README.md)。`wrangler.jsonc` 开启 `observability.enabled`，可在 Cloudflare 控制台 Workers → 对应 Worker → Logs 按 `event`、`level` 查询历史日志。实时查看：

```sh
npx wrangler tail <worker-name> --format pretty
# 只看以异常结束的请求（日志级别请在 JSON 的 level 字段筛选）
npx wrangler tail <worker-name> --format json --status error
```

`wrangler tail` 输出可能含请求 URL；保存或转发前去掉查询串，不要提交到仓库。

## 上线前检查

- 完整浏览器 E2E 和手机尺寸视觉检查。
- 授权作者身份、非作者访问、Token 到期/撤销及跨域请求。
- 发布快照、密码访问、媒体权限和旧文章附件读取。
- 数据库迁移、备份、恢复、容量和运行告警。
- 模型调用成本、额度、超时和失败恢复。
- 不含真实密钥、笔记、数据库或缓存的交付包与 Git 历史。

## 独立作者认证（代码已提供，尚未开启）

独立部署可选择 `AUTH_MODE=password`，通过安全配置提供 `OWNER_EMAIL`、`AUTH_PASSWORD_HASH` 与至少 32 字符 `SESSION_SECRET`，并应用追加的作者会话表迁移。不要把明文密码或可用凭据放进源码、命令参数或日志。新口令至少 15 字符，不开放公众注册；账号配置必须由部署者显式完成，不能首访认领。当前托管预览仍使用 Sites 身份，不修改其访问权限。

密码哈希采用 PBKDF2-SHA256 600,000 次；不支持这一策略的运行时返回 503，不降低参数。Cloudflare 生产运行时的迭代限制与 CPU 预算必须单独验证，本地 Node/workerd 通过不能证明生产可用。正式环境选择尚待确认，不得将当前密码模式称作已完成生产认证验收。详见[认证模块边界](../src/server/auth/README.md)。

登录页面仅在 HTTPS 下显示密码表单；会话 Cookie 为 HttpOnly、Secure、SameSite=Strict，8 小时绝对到期。新登录轮换会话，退出服务器端撤销；更换邮箱、密码摘要或签名密钥使旧会话失效。第一版无空闲续期、无公开注册或邮件找回密码服务。

## Google 单作者模式（实现准备，未部署验收）

新增 `AUTH_MODE=google` 面向独立 Workers 部署，使用 Google OIDC 授权码流程，要求 HTTPS、state、浏览器绑定、PKCE 和 nonce，作者邮箱必须事先显式配置，不允许首位访问者认领。非 Gmail 邮箱还需固定 `OWNER_GOOGLE_SUB`。实际作者邮箱不写入源码或前端包。

部署配置名称：`APP_ORIGIN`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`OWNER_EMAIL`、`SESSION_SECRET`，可选 `OWNER_GOOGLE_SUB`。Google Web OAuth 客户端的回调地址必须精确为 `APP_ORIGIN` 加 `/api/auth/google/callback`；只请求 `openid email profile`（profile 仅用于显示昵称；三者均为 Google 非敏感默认范围，同意屏幕无需验证），不请求离线刷新或其它 Google API 权限。真实凭据创建和持久配置须单独授权；不通过聊天传递密钥。

部署前需应用追加迁移 `0003_google_author_auth.sql`。临时流程十分钟到期并原子消费；应用作者会话为八小时随机不透明令牌，数据库保存哈希，支持退出撤销与配置轮换失效。不存储 Google access/refresh/id token。

当前仅为待验证实现，生产预览继续 `AUTH_MODE=sites`。真实 Google OAuth、目标 Cloudflare 配置、生产 CPU/会话/越权、数据库迁移与备份恢复均必须记录实际结果后才允许称作上线完成。新增签名库的安装及完整测试若被环境权限阻塞，应明确记录，不使用本地 UI mock 结果替代。
