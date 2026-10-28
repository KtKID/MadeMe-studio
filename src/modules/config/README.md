# 配置模块 `src/modules/config/`

站点里所有“限额、超时、上限、端点、默认值”的**唯一来源**。规则：**魔法数字不写在业务代码里**，一律从这里取；前端和服务端用同一个常量 / 同一个函数，不允许“几个地方各写一次 25 MB”。

## 三层配置

| 层 | 是什么 | 放在哪 | 谁能改 | 生效 |
| --- | --- | --- | --- | --- |
| A 作者可调 | 上传大小、限流次数、会话时长、RSS 条数等 | 默认值 `defaults.ts`，范围 `schema.ts`，中文名 `meta.ts`；作者改过的值存 D1 `settings.document_json.limits` | 作者在“设置 → 上传与媒体 / AI 用量 / 账号与安全 / 嵌入与阅读” | 保存后下一次请求生效（每个请求读一次 D1，不跨请求缓存） |
| B 部署环境 | D1/R2 绑定、AUTH_MODE、OWNER_*、Google OAuth、SESSION_SECRET、AI 密钥、LOG_LEVEL、本地 DEV_PORT | `wrangler.jsonc` / Cloudflare Secrets / `.dev.vars`；读取与“是否已配置”判断在 `env.ts`；本地端口在 `scripts/dev-config.mjs` | 部署者 | 重新部署 |
| C 代码常量 | 硬上限（上传 50 MB）、文本长度、正文深度、令牌格式、AI 端点、限流窗口等 | `limits.ts`、`endpoints.ts` | 改代码 | 发版 |

设置页“账号与安全”底部的**部署信息**卡片只读显示 B 层各项“已配置 / 未配置”（`GET /api/deployment`，仅作者），**从不下发密钥值**。

## 文件

- `product.ts`：C 层发布配置 `PRODUCT_VERSION`，当前为 `0.5`，仅用于产品页脚展示；不写入 D1、不暴露作者可编辑字段，不与 npm 包版本或健康接口版本自动绑定。
- `limits.ts`：C 层常量。上传硬上限 `HARD_MAX_UPLOAD_MB = 50`，MIME 白名单 `MEDIA_TYPES`，正文上限、文本长度 `TEXT_LIMITS`、AI 参数 `AI_PARAMS`、令牌格式 `OPAQUE_TOKEN_PATTERN`、`SESSION_SECRET_MIN_LENGTH`、认证限流 `AUTH_RATE_LIMITS`、PBKDF2 次数等。
- `endpoints.ts`：AI 供应商与 Google OAuth 端点表；出站白名单 `AI_PROVIDER_HOSTS` 从端点表推导，新增端点不会忘记放行，也不会多放行。
- `defaults.ts`：A 层默认值 `DEFAULT_CONFIG`（唯一写 25 MB 的地方）。
- `schema.ts`：
  - `runtimeConfigSchema`（宽松读取）：D1 里的值缺失 / 类型不对 → 回退默认值；越界 → 夹紧到范围内；永不抛错，坏数据不会让站点挂掉。
  - `runtimeConfigPatchSchema`（严格写入）：越界、非整数、未知字段直接拒绝，错误信息是中文（例如“视频单个文件上限：不能大于 50 MB（上限）”）；`null` 表示恢复默认。
  - `configCrossProblems`：跨字段规则（令牌默认有效期 ≤ 最长有效期）。
- `meta.ts`：分组、标签页与每项的中文名称 / 单位 / 说明；`reader: true` 的项会下发给读者页面。
- `public.ts`：前后端共用的函数。`uploadProblem(file, upload)` 是**唯一的上传检查**，编辑器、媒体库和服务端 `validateMedia` 都调用它；`toClientConfig` 按身份裁剪下发内容；`uploadHint` / `formatsLabel` 生成“MP4、WebM、MOV，≤ 25 MB”这类文案。
- `env.ts`：B 层读取（`sessionSecretConfigured`、`parseLogLevel`、`deploymentStatus`）。只在服务端使用。
- `server.ts`：`loadConfig(env)` 读 D1 并解析；`requestConfig(context)` 在同一个请求内只读一次。读取失败记 `config.load_failed` 并使用默认值。只在服务端使用。
- `index.ts`：浏览器可用的入口（不含 `server.ts`、`env.ts`）。

`schema.ts` / `public.ts` / `limits.ts` / `defaults.ts` / `meta.ts` 之间写显式 `.ts` 扩展名：`src/shared/contracts.ts` 会被 `integrations/` 的 Node 工具直接加载，Node 不支持目录导入或省略扩展名。

## 新增一个作者可调配置项

1. `defaults.ts`：在对应分组加默认值。
2. `schema.ts`：在 `NUMBER_RANGES`（数值）或 `LIST_OPTIONS`（多选）加范围；类型加字段。
3. `meta.ts`：加中文名称、单位、说明；读者页面要用就标 `reader: true`。
4. 使用处：服务端用 `requestConfig(context)` / `loadConfig(env)`，前端用 `settings.limits`。不要在使用处再写默认值。
5. 测试：`tests/unit/config.test.ts` 会检查三处键名一致。

设置页会自动多出这一项（带默认值、范围和“恢复默认”）。D1 不需要迁移：未保存过的项按默认值读取。

## 存储方式

作者只保存**改过且不同于默认值**的项。设置页把改回默认的项发送为 `null`，服务端 JSON merge patch 删除该键。这样以后调整默认值，没改过的站点会自动跟随新默认。

## 与日志的关系

配置读取失败、令牌有效期越界、上传被拒绝等都会经过 `src/modules/log`（如 `config.load_failed`、`media.upload_rejected`），不记录文件名、邮箱或令牌。
