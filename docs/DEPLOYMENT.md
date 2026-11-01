# 部署与本地运行

## 运行结构

Astro 服务端渲染及 API 运行于 Cloudflare Worker；D1 绑定名为 `DB`，R2 绑定名为 `BUCKET`。`wrangler.jsonc` 默认配置中的数据库 ID 是本地占位符；命名环境 `production` 才绑定已核实的生产资源。`drizzle/` 仅包含结构迁移，不包含作者、文章或密钥种子数据。

生产构建生成 `dist/client` 静态资产及 `dist/server` Worker；`scripts/package-worker.mjs` 创建托管兼容入口，同时保留 Astro 原始入口。`.openai/hosting.json` 声明绑定，不应保存凭据。

## 既有 Cloudflare 生产 Worker：自动部署准备

本节是 2026-11-01 准备的配置方案，最终采用 **GitHub Actions，不连接 Cloudflare Workers Builds**。补丁通过独立分支和PR审查；此执行器未创建 token、设置 secret 或执行生产发布；用户已重建专用单 Worker token，并明确确认已保存为仓库 Actions Secret `CLOUDFLARE_API_TOKEN_FOR_DEPLOY`；仓库名称列表已独立核验，未读取其值，首次发布结果仍须在 Actions 和 Cloudflare 核实。下文的 Sites 说明属于另一个预览目标，不能据此覆盖生产认证。

### 目标与保留范围

| 项目         | 已核实目标                                                    |
| ------------ | ------------------------------------------------------------- |
| Worker       | `author-studio`，不是新建 `author-studio-production`          |
| 既有自定义域 | `blog.ktkid.ai`；继续由控制台管理                             |
| `DB`         | D1 `author-studio`，ID `c2758015-872a-454b-8915-68a8a662040c` |
| `BUCKET`     | R2 `author-studio-media`                                      |
| `ASSETS`     | 构建后的 `dist/client`                                        |
| 兼容设置     | `2026-10-01`、`nodejs_compat`                                 |

`production` 显式重复 D1/R2 绑定，因为绑定不从默认环境继承。默认 `npm run build` 仍使用本地占位 ID，供本地隔离测试；真实部署脚本会在调用 Wrangler 前拒绝这种产物。不要把生产环境配置用于日常测试，也不要额外执行远程数据库迁移或媒体迁移脚本。

顶层 `keep_vars: true` 适用于所有环境，保留控制台设置的普通变量；它不保护路由或任意其它设置，源码中显式写入同名变量仍会覆盖。当前不在源码或构建产物写入运行变量值：沿用现有 `APP_ORIGIN`、`AUTH_MODE`、`ENVIRONMENT`、`GOOGLE_CLIENT_ID`、`OWNER_EMAIL`。现有 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_AI_TOKEN`、`GOOGLE_CLIENT_SECRET`、`SESSION_SECRET` 继续是运行时 secret，不读取其值，也不复制到构建配置。Wrangler 默认继承现存 secrets，本流程不调用 secret 写入或删除。

### 构建与发布命令

[ci.yml](../.github/workflows/ci.yml) 在原有 `test` job 成功后，用 `needs: test` 调用同提交的 [deploy-production.yml](../.github/workflows/deploy-production.yml)。其固定配置：

| 设置                  | 值                                 |
| --------------------- | ---------------------------------- |
| Git 仓库 / 生产分支   | `KtKID/MadeMe-studio` / `main`     |
| 根目录                | 仓库根目录                         |
| Node / 生产构建变量   | `24` / `CLOUDFLARE_ENV=production` |
| Build command         | `npm run build`                    |
| Deploy command        | `npm run deploy:production`        |
| 构建账户 ID（非秘密） | `aa31bc6b12b747b89ccb446e43aef6c4` |

CI 保留原有 push/PR 检查，增加 `workflow_dispatch` 手动入口；只有本仓库 main 的 push/手动事件才进入 deploy job。手动运行其它分支或 tag 仅能检查，不能发布。调用方、被调用 job 与脚本均拒绝 PR、fork、tag、其它仓库或分支发布；没有自填部署 SHA 入口。`actions/checkout` v6.1.0 和 `actions/setup-node` v6.5.0 固定完整官方提交 SHA，checkout 不保留凭据，无其它 Action，不下载其它工作流产物。`permissions` 只有 `contents: read`，不创建 deployment environment 或要求额外写权限。

原有 CI 先运行 `npm ci` → `npx vitest run` / `test:integrations` / `check`，成功后 `needs: test` 才进入发布 job；发布 job 重新精确 checkout 和安装依赖，再运行默认本地 build → 隔离 `test:smoke` → 隔离 `test:worker` → 生产 build → `verify:production`。所有步骤都是硬门槛，没有 `continue-on-error`，失败不进入发布。**当前普通 CI 没跑 build/smoke/worker，CI 通过不等于这组发布检查通过**。本轮在未修改 main 复现了旧用例仍查找 `valid-image.png`、期待PNG原样返回的失败；随后仅更新测试以符合已存在的WebP落库契约，新增文件名/MIME/签名/大小断言，以实际WebP作为Range字节基准，完整流程已通过。没有跳过检查或修改媒体业务实现。

专用部署 token 只在最后发布步骤注入 `CLOUDFLARE_API_TOKEN`，不会注入安装、测试或构建阶段；`GITHUB_TOKEN` 同步只用于只读核对 main。用户最终确定仓库 Actions Secret 名称为 `CLOUDFLARE_API_TOKEN_FOR_DEPLOY`，Wrangler 的环境变量名仍为 `CLOUDFLARE_API_TOKEN`；CI 只将这一项显式传给可复用工作流的 `cloudflare_deploy_token`，不使用 secrets inherit 或其它 token 回退。此执行器未读取/保存 secret，不要求用户改名或重建；Secret 名称列表已核验；合并发布仍须通过必要检查及审查。

选择 Node 24 以满足 `engines.node >=24`；依赖由锁文件安装，不能排除构建所需的 devDependencies。`CLOUDFLARE_ENV` 必须在**构建时**设置，Astro/Vite 在这一步选择 Wrangler 环境。不要先按默认环境构建，再仅给部署命令补 `--env production`。

本地无凭据验证：

```sh
CLOUDFLARE_ENV=production npm run build
npm run verify:production
```

实际构建确认产物为 `dist/server/wrangler.json`，入口 `entry.mjs`、`no_bundle: true`，静态目录相对该文件为 `../client`，保留 `keep_vars`、生产 DB/R2/ASSETS。`.wrangler/deploy/config.json` 也指向它；脚本仍显式指定该生成文件，不使用托管兼容入口 `index.js` 或原始适配器别名发布。

工作流启用后，`npm run deploy:production` 的步骤是：

1. 只接受 `GITHUB_ACTIONS=true`、目标 `GITHUB_REPOSITORY`、`GITHUB_REF=refs/heads/main`、push/手动事件及完整 `GITHUB_SHA`。以只读 GitHub API 再核对当前 main，API 失败或 SHA 过时即停止；再校验构建产物、目标及绑定。CI 元数据是防误用检查，不代替 token 权限。
2. `wrangler versions upload --config dist/server/wrangler.json --strict --tag <该提交SHA>`，只上传到已经存在的 Worker；不创建 Worker、不应用数据库迁移。
3. 从 Wrangler 官方 NDJSON 输出读取本次唯一的 `version-upload` UUID，执行 `wrangler versions deploy <本次UUID>@100% --config <临时仅含Worker名称的JSON> --yes`。不按 `latest` 或相同 tag 猜测，上传结果不明确时不会切流量。
4. 要求命令成功及对应 Worker 的 `version-deploy` 结果，记录版本与 deployment ID。命令超时/异常或确认缺失时不自动重试；尤其发布阶段异常须先查控制台部署历史，不能假设未执行。

采用版本上传再精确切流量，是为了保留既有 Routes、自定义域、`workers.dev`、预览地址等设置。普通 `wrangler deploy` 会协调路由，省略 `workers_dev` 也有默认行为；本流程不调用 triggers，也不猜测当前访问设置。`versions deploy` 可能同步配置内的 observability 等非版本设置，因此第二步切流量只传 Worker 名称，不拿完整生成配置覆盖它们。上述行为经过当前锁定 Wrangler 4.153.0 源码及离线测试核对；真实账户执行和线上验证仍待授权通道。

CI 的 main 并发组不取消正在运行的流水线，其它分支仍保留取消旧 CI 的行为；被调用部署工作流使用不同的固定 `production-author-studio` concurrency group、`cancel-in-progress: false`，防止此工作流并发生产发布或在切流量中途被新提交取消；排队旧提交在发布前被 main 核对拒绝。main 核对与 Cloudflare 发布跨平台，不能做成原子事务；极短窗口内 main 更新仍可能先完成当前已验证提交再发布新提交。此锁不覆盖手工 Wrangler/其它系统，发布时不能同时由另一部署者改配置或上传版本。普通变量和 secret 由 Cloudflare 的继承机制保留，不是可恢复的配置备份。

### 部署 token：单项目权限及验证边界

用户批准专用 token，仅 `author-studio` 的 `Individual Workers Editor`，不更改任何已有 token，不给 D1/R2 或路由编辑权限。由控制台任务直接存入本仓库 Actions Secret，不经此执行器或聊天传递值。完整首次发布尚未实测；若权限被 API 拒绝，应报告确切步骤，不能自动扩大 token 范围。

权限应区分旧模型与新模型：

- 旧 `Account → Workers Scripts Edit/Write` 可以限制到目标账户，但覆盖该账户的 Workers，**不能仅凭脚本名称限制到一个 Worker**。
- 官方新版 [Workers 角色](https://developers.cloudflare.com/workers/authorization/workers/)支持对已存在的单个 Worker 授予 `Editor`，API 的版本上传与部署也接受 `Individual Workers Editor`。代码不会创建新 Worker，完整 Wrangler 流程是否通过仍需真实首次发布验证。
- 官方说明，仅部署绑定已有 D1/R2 的 Worker 不需要这些资源的独立读写权限；只有直接查询数据库、列举/读写对象等操作才需要。此次没有这类操作，不应为此授予 D1/R2 编辑权限。
- 不变更 Routes/自定义域的版本部署不要求 Zone Workers Routes Write。若以后确实管理路由，Zone 权限可只限定相关 zone；不是所有 zone，也不是按单个域名记录隔离。官方同时注明 Custom Domains 暂不支持 per-Worker roles，应在首次真实验证时注意这一限制，不擅自扩大权限。

[GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 是官方支持的执行环境；它不会自动缩小 Cloudflare token 的范围。运行时的 `CLOUDFLARE_ACCOUNT_ID` secret 与构建用的上述公开账户 ID 是不同配置渠道，不能读取运行时 secret 来借用部署授权。先前调查的 Workers Builds 自有用户 token 路径仅是官方文档能力，当前方案不启用该服务，也不自动创建它的宽权限 token。

依据：[Wrangler 配置及 keep_vars](https://developers.cloudflare.com/workers/wrangler/configuration/)、[Astro Cloudflare 适配器](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)、[Worker 版本](https://developers.cloudflare.com/workers/versions-and-deployments/)、[API token 资源范围](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)、[版本上传 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/)、[部署 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/)。首次上线结果须另记，不用离线 dry-run 替代生产部署确认。

## 本地开发

1. 使用 Node.js 24，在仓库根目录执行 `npm ci`。
2. 复制 `.env.example` 为 `.dev.vars`，仅用于本地隔离实例。该文件已被 Git 忽略，不能提交。
3. 应用本地迁移：

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run dev
```

默认开发服务只绑定 `127.0.0.1`。示例中的测试身份仅在回环地址、`ENVIRONMENT=development`、显式允许开发身份且作者 ID 匹配时生效。不要对公网开放开发实例，也不要将开发身份配置复制到生产。

`npm run build` 只构建，不会替生产数据库应用迁移。真实 Worker 冒烟和 HTTP E2E 均自动创建全新临时 D1/R2、应用迁移并启动测试进程，结束后清理。先完成构建，再串行运行 `npm run test:smoke` 与 `npm run test:worker`，预留回环端口 DEV_PORT / DEV_PORT+1（默认 4321/4322，见 `scripts/dev-config.mjs`）；无需提前启动开发服务。详见 [Worker 测试](../tests/worker/README.md)。浏览器用例另需可用浏览器与隔离应用实例，配置方式见 `playwright.config.ts` 和测试目录说明。

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

登录页面仅在 HTTPS 下显示密码表单；会话 Cookie 为 HttpOnly、Secure、SameSite=Strict，默认 8 小时绝对到期（设置页“账号与安全 → 登录会话时长”可调 1–168 小时，只影响之后的新登录）。新登录轮换会话，退出服务器端撤销；更换邮箱、密码摘要或签名密钥使旧会话失效。第一版无空闲续期、无公开注册或邮件找回密码服务。

## Google 单作者模式（实现准备，未部署验收）

新增 `AUTH_MODE=google` 面向独立 Workers 部署，使用 Google OIDC 授权码流程，要求 HTTPS、state、浏览器绑定、PKCE 和 nonce，作者邮箱必须事先显式配置，不允许首位访问者认领。非 Gmail 邮箱还需固定 `OWNER_GOOGLE_SUB`。实际作者邮箱不写入源码或前端包。

部署配置名称：`APP_ORIGIN`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`OWNER_EMAIL`、`SESSION_SECRET`，可选 `OWNER_GOOGLE_SUB`。Google Web OAuth 客户端的回调地址必须精确为 `APP_ORIGIN` 加 `/api/auth/google/callback`；只请求 `openid email profile`（profile 仅用于显示昵称；三者均为 Google 非敏感默认范围，同意屏幕无需验证），不请求离线刷新或其它 Google API 权限。真实凭据创建和持久配置须单独授权；不通过聊天传递密钥。

部署前需应用追加迁移 `0003_google_author_auth.sql`。临时流程十分钟到期并原子消费；应用作者会话为八小时随机不透明令牌，数据库保存哈希，支持退出撤销与配置轮换失效。不存储 Google access/refresh/id token。

当前仅为待验证实现，生产预览继续 `AUTH_MODE=sites`。真实 Google OAuth、目标 Cloudflare 配置、生产 CPU/会话/越权、数据库迁移与备份恢复均必须记录实际结果后才允许称作上线完成。新增签名库的安装及完整测试若被环境权限阻塞，应明确记录，不使用本地 UI mock 结果替代。
