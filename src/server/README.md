# 服务端编排模块

负责将共享 Zod 协议与身份、文章、设置、媒体、模型服务组合为 HTTP API。数据来自 D1/R2；不使用浏览器 localStorage 代替持久化。

## 文件与边界

- `api.ts`：路由调度、身份/权限、同源检查、请求协议校验。
- `http.ts`：有上限的请求体读取、JSON 响应和统一错误包装。
- `runtime.ts`：最小 D1/R2 接口及运行时配置，不包含凭据默认值。
- `page-data.ts`：SSR 所需的可见内容。作者阅读已发布快照，编辑接口另读草稿。
- `settings.ts`：设置持久化与访客脱敏；不接受密钥配置字段。
- `tokens.ts`：单次显示随机令牌、存储 SHA-256 摘要、scope 和撤销。
- `rate-limit.ts`：D1 原子窗口计数，保护密码尝试及模型调用。
- `errors.ts`：可公开的错误；意外异常不向客户端返回堆栈或上游正文。
- 日志：统一使用 [日志模块](../modules/log/README.md) 的 `server.ts`（见下文）。

## 统一日志

日志逻辑位于独立模块 [src/modules/log](../modules/log/README.md)（API、级别约定、脱敏规则、输出格式与查看方式见该 README）。服务端接入点：`http.ts` 的 `errorResponse` 按状态码统一记录 API 异常，`../middleware.ts` 记录页面渲染未处理异常，其余 catch 使用 `logCaught`。

## 子模块

- [身份与访问控制](auth/README.md)
- [文章与版本](content/README.md)
- [数据库结构](db/README.md)
- [媒体对象](media/README.md)
- [模型适配器](ai/README.md)

## 运行时配置

`DB`、`BUCKET` 分别绑定 D1、R2。Sites 模式须明确设置 `AUTH_MODE=sites` 和 `OWNER_ID`，或在尚未知道站点身份 ID 时设置受信任拥有者的 `OWNER_EMAIL`。`OWNER_ID` 存在时优先且不回退邮箱。密钥只通过安全运行时配置提供，不提交到仓库。

`SESSION_SECRET` 至少 32 字符，供密码文章的签名 Cookie 使用。开发身份需要同时配置 `ENVIRONMENT=development`、`ALLOW_LOCAL_DEV_IDENTITY=true`、`DEV_OWNER_ID` 和匹配的 `OWNER_ID`，并且请求地址必须为 localhost/回环地址。

## 验证

`npm test -- tests/backend` 包含单元、真实 SQLite 迁移/事务、服务端冒烟和真实本地 HTTP E2E。此处 HTTP E2E 不等同于浏览器端 BlockNote 操作测试；浏览器测试由界面模块单独负责。

设置 PATCH 在 D1 单条 UPSERT 内使用 `json_patch` 原子合并，避免并发更新不同字段互相覆盖。相同字段并发更新按数据库写入顺序生效。首页使用 `loadPublicPageData`，即使作者访问也只展示公开发布快照。

## 页面读取成本

`loadPageData` 的无文章模式用于设置、媒体、连接和新建页面，不查询全量文章；编辑页仅按指定 ID 读取且先核验作者身份。身份与站点设置读取并行，仍按请求执行鉴权，不跨请求缓存私人内容。文章列表页保留列表查询。

## 工作台首屏数据

文章列表使用 owner-only `loadDashboardPageData` + `listSummaries`，SQL 仅提取共享 `postSummarySchema` 的 12 个字段；正文、发布快照及密码摘要不进入列表传输。访客仍先经过原公开发布快照筛选，不使用草稿摘要替代。媒体与连接页面鉴权之后 SSR 读取安全初始列表，避免 hydration 后额外 GET；查询失败以明确错误传给界面，不把失败当空列表已就绪。私有 HTML/图片继续 `private, no-store`。
