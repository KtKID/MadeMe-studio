# 2026-10-27：配置模块 `src/modules/config/`（限额公开 + 前后端对齐）

## 现象 / 根因

- “25 MB”等限额写死在多处（contracts、媒体服务、编辑器文案、api.ts 的 `26 * 1024 * 1024` 请求体上限、AI 生图下载），改一处其他地方不会跟着变；作者也无法在设置里调整。
- 前后端各抄一份数值，已经对不上：
  - Markdown 导入：编辑器允许 2 MB，服务端正文 1,000,000 字符、JSON 体 1.1 MB，插件 512 KiB。1–2 MB 的文件前端放行、服务端必然失败。
  - 正文嵌套深度：编辑器预检 40，服务端 30。
  - slug：契约 160，`slugify` 截到 100。
  - 会话 8 小时、`mm_` 令牌格式、`SESSION_SECRET ≥ 32`、令牌天数、表单 maxLength 等在 2–6 处重复。
  - 开发地址：`package.json` 用 `--host`，astro 配置是 0.0.0.0，测试脚本各写 4321/4322。
- 首页 / RSS / 站点地图 `LIMIT 1000` 截断时没有任何提示；日志没有级别阈值。

## 修改内容

### 新模块 `src/modules/config/`（中文 README）

| 文件 | 作用 |
|---|---|
| `limits.ts` | C 级常量与 `HARD_MAX_*` 硬上限（唯一出处）：上传 50 MB、MIME 白名单、正文 1M 字符 / 深度 30 / 5 万节点、文本长度、AI 参数、会话/令牌/解锁上限、PBKDF2、登录限流、嵌入高度范围 |
| `endpoints.ts` | AI / Google 端点表；AI 出站白名单由它推导 |
| `defaults.ts` | A 级默认值（**25 只出现在这里**） |
| `schema.ts` | 宽松读取 schema（坏值逐字段回退默认、越界夹紧）+ 严格写入 schema（中文错误，null = 恢复默认）+ 交叉校验（令牌默认天数 ≤ 最长天数） |
| `meta.ts` | 设置页分组、中文标签、单位、说明 |
| `public.ts` | 前后端共用的上传检查 `uploadProblem`、文案 `uploadHint` / `formatsLabel` / `formatBytes` |
| `env.ts` / `server.ts` | 部署信息（只报“已配置/未配置”）、`LOG_LEVEL`；`loadConfig` / 单请求 memo 的 `requestConfig` |

### 存储

沿用 `settings.document_json`，新增 `limits` 字段，只保存改过的项（json_patch，null 删除）。**没有 D1 迁移**。

### 服务端接入

- `api.ts`：限流、令牌有效期（超出返回 422 `TOKEN_EXPIRY_TOO_LONG`）、请求体上限 = 文件上限 + 1 MB；新增作者专用 `GET /api/deployment`。
- `media/service.ts`：按类型的大小上限与禁用格式，返回中文 413/415；媒体列表条数。
- AI：`transport`、`text`、`models`、`images` 使用请求超时与端点表；生图下载上限使用 `GENERATED_MEDIA_POLICY`。
- 账号与安全：`auth/password.ts`、`auth/google.ts` 的会话时长；`access.ts` 的解锁 Cookie；`crypto.ts` / `identity.ts` 共用 `mm_` 令牌格式。
- 正文：`content/validation.ts`、`markdown.ts`、`http.ts`、`content-check` 使用统一的正文上限。
- 列表与 RSS：`repository.ts` 的版本条数，截断时记 `content.list_truncated`；RSS 条数。
- 日志：`log/server.ts` 加 `LOG_LEVEL` 阈值；`google.ts` 复用 `log/redact.ts` 的 `SAFE_CODE`。

### 前端接入

- `SettingsPanel` 新增四个标签页：上传与媒体 / AI 用量 / 账号与安全 / 嵌入与阅读（`ConfigSection.tsx`）。
  - 每项显示默认值与范围；每组有“恢复默认”。
  - 越界时显示中文错误并阻止保存，不静默替换。
  - 增加只读的“部署信息”卡片。
- 编辑器、媒体库在上传前用同一个 `uploadProblem` 检查，文案由配置生成。
  - Markdown 导入上限来自配置，并再按正文上限检查。
  - 嵌入平台被关闭时，按钮禁用并给出提示。
- 阅读页：
  - 已关闭平台的旧嵌入显示为“在 X 查看”链接卡片。
  - X 降级等待时间、初始高度、卡片标签数、RSS 条数来自配置。
- 令牌页、登录页、设置页的 maxLength 与范围都取自 `TEXT_LIMITS` / 配置。

### 开发与测试脚本

`scripts/dev-config.mjs` 统一 `127.0.0.1` 与 `DEV_PORT`（默认 4321，第二实例 +1）。astro、playwright、smoke 和 worker 脚本都从这里读取。

### 文档

- 新增 `docs/DEVELOPMENT.md` 规则：“魔法值走 `src/modules/config`”。
- 同步更新 DEPLOYMENT、log、media、editor、auth、embed、scripts、tests/worker 的 README。

## 行为变化（需知）

- Markdown 导入默认上限 2 MB → 512 KB（可在设置里调到约 976 KB，这是正文上限对应的大小）。
- RSS 默认输出最新 50 篇（按发布时间），原来全部输出。
- 上传错误改为中文；超出上限返回 413，禁用格式返回 415。
- 文章密码功能要求 `SESSION_SECRET` ≥ 32 字符（与其他地方一致）。
- 开发服务只绑定 127.0.0.1。
- 新 slug 正文部分最多 153 字符（160 − 后缀 7）。

## 验证

- `npm run check`：0 错误 0 警告。
- `vitest`：72 个文件 558 个测试全部通过（原 516）。新增：
  - `tests/unit/config.test.ts`（21）：回退与夹紧、严格 schema 的中文错误、前后端共用上传检查。
  - `tests/config-runtime.test.tsx`（10）。
  - `tests/backend/config-api.test.ts`（7）：只存改动项、422、413/415、令牌天数、部署信息仅作者可见、RSS 条数。
  - `tests/ui/settings-config-clicks.test.tsx`（4）。
- `npm run test:integrations` 19/19；`test:smoke`、`test:worker`、作者认证 worker 回归均通过（使用新端口配置）。
- 线上（版本 77fce934，2026-10-27 21:49 UTC+8；部署前后 `git diff wrangler.jsonc` 为空；无 D1 迁移）：
  - 首页、`/rss.xml`、`/login`、`/sitemap.xml`、`/p/cf-46630d` 均返回 200。
  - 未登录访问 `/api/deployment` 返回 401。
  - `/api/settings` 返回完整默认配置；阅读页带 `data-embed-fallback-ms="12000"`。

## 暂缓项

- 首页分页（目前只在截断时记 warn 日志）。
- 按供应商校验生图尺寸。
- 在“提示词”页展示内置 AI 指令。
- 超过 50 MB 的上传：需要先改为流式写入 R2。
- PBKDF2 600000 次（生产 Workers 不支持）；登录时自动升级哈希。
- 编辑器预览中的嵌入开关效果。
- 作者密码哈希在生产不可用（已在 auth README 记录）。
- integrations 源码链接分支 `feat/v1`：需要先决定发布分支。

## 如何避免

- 新的数值、限额或端点一律加到 `src/modules/config/`。
  - 作者可调的项进 `defaults.ts`、`schema.ts`、`meta.ts`。
  - 固定的项进 `limits.ts` / `endpoints.ts`。
  - 前后端都从这里 import，不要在组件或服务里另写数字。
- 前后端都会做的检查（上传、正文大小）写成 `public.ts` 里的纯函数，两端调用同一个函数。
- 被 Node 工具直接加载的文件（contracts → config）import 时带 `.ts` 后缀。
- Zod 4 中 `transform` 字段在 object 里会被当成必填，可选字段要用 `.optional().transform()`。
