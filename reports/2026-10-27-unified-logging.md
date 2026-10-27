# 修复报告：失败与错误静默——引入统一日志接口

日期：2026-10-27（UTC+8）　分支：`feat/google-auth`（未提交）　部署版本：`3f67ea2e-cab1-4977-a3e6-047584a08c1b`

## 现象

Google 登录排障期间，回调只返回固定的 `google_failed`，Worker 没有任何日志，只能靠本地 workerd 探针反推根因。审计发现多处 catch 把异常转换为响应或默认值后丢弃原始错误，线上无从排查。

## 根因

没有统一的日志接口与约定，各处 catch 各自处理：

- `src/server/http.ts` `errorResponse`：所有 API 异常（含 500）转为 JSON 响应，不记录。
- `src/server/auth/google.ts`：`providerJSON` catch 转 503 不记录；回调 catch 仅 `console.warn("google_callback_failed", { stage })`（非结构化）。
- `src/server/ai/transport.ts`、`src/server/ai/images.ts`：fetch 异常与非 2xx 不记录（掩盖了 `redirect: "error"` 问题）。
- `src/server/auth/crypto.ts` `verifyPassword`：KDF/摘要异常静默 `return false`，与"密码错误"无法区分。
- `src/server/auth/password.ts` KDF 不可用：转 503，丢弃原始异常。
- `src/server/media/service.ts`：D1 失败后回滚 R2，回滚本身失败会覆盖原始错误且留下无记录的孤儿对象。
- `src/server/page-data.ts`：媒体与令牌 SSR 加载失败只显示提示文字。
- `src/middleware.ts`：页面渲染未处理异常无应用级日志。
- 浏览器端：`ui.tsx` 的 `api()`（`.catch(() => ...)` 吞掉不可读响应、协议不符、网络异常）、`StudioShell.tsx` 身份复核、`auth/client.ts`、`Integrations.tsx` 复制失败、性能采样存储失败。

## 修复内容（文件）

- 新增 `src/shared/log-redact.ts`（现为 `src/modules/log/redact.ts`）：强制脱敏（敏感键名整体替换；字符串中邮箱、Bearer、JWT、`code=`/`state=` 等查询参数、`mm_`/`sk_` 令牌与长随机串擦除；深度/长度上限；Request/Headers 不展开）与异常序列化（name、擦除后的 message、固定大写错误码、status，可选堆栈与 cause）。
- 新增 `src/server/log.ts`（现为 `src/modules/log/server.ts`）：`logger.debug/info/warn/error`、`logCaught`、`requestLogContext`（`cf-ray` 或随机 ID，路径不含查询串）；每条日志为一行 JSON，兼容 Workers Logs 与 `wrangler tail`。
- 新增 `src/components/shared/client-log.ts`（现为 `src/modules/log/client.ts`）：浏览器端 `clientLog`/`clientCaught`，仅写控制台，不上报外部服务。
- 接入点：`http.ts` errorResponse（401/403/429 warn、其它 4xx info 只记错误码，5xx/意外异常 error）、`api.ts` 传入请求上下文、`middleware.ts` 未处理异常、`google.ts`（`auth.google.provider_failed`、`auth.google.callback_failed` 保留 stage）、AI transport/images、crypto、password、media 回滚、page-data、上述浏览器端各处。纯判定函数（URL 解析失败返回 false）加注释说明由调用方记录。
- `wrangler.jsonc`：新增 `observability.enabled: true`（仓库版本与生产配置副本均已加入）。
- 文档：`docs/DEVELOPMENT.md` 执行约定（失败不得静默、Workers fetch 约束、每次修复写报告）、`docs/DEPLOYMENT.md` 日志查看、`src/server/README.md` 统一日志、`src/server/auth/README.md`、`src/server/ai/README.md`、根 `README.md`。
- 测试：新增 `tests/unit/log.test.ts`（格式、四个级别、15 类敏感字段脱敏、字符串擦除、异常序列化、errorResponse 级别、verifyPassword/媒体回滚 catch 路径、浏览器日志与 `api()` 失败路径）与 `tests/backend/log-capture.ts`；Google 阶段日志测试改为断言结构化事件且不含 state、code、邮箱、client secret。

## 验证方式与结果

- Google 相关 5 个文件 75 项通过；完整 `npm test` 59 个文件 422 项通过（此前 58/382）；`npm run check` 0 错误；`npm run build`、`test:smoke`、`test:worker` 通过（仓库原始配置 + observability）；随后恢复生产配置并核对 D1 ID 与 vars 后部署。
- 线上 `wrangler tail`（版本 `3f67ea2e`）：伪造 `code=bogus` 回调产生 `auth.google.provider_failed {endpoint:"token", httpStatus:400}` 与 `auth.google.callback_failed {stage:"token", outcome:"google_failed", errorCode:"GOOGLE_UNAVAILABLE", requestId, path}`；未登录写入产生 `request.rejected {status:401, code:"UNAUTHORIZED"}`；`Origin: null` 产生 `request.rejected {status:403, code:"CSRF_REJECTED"}`。日志中未出现 state、code、邮箱、client secret 或 code_verifier。

## 如何避免再次踩坑

1. 新增 catch 必须调用 `logCaught` 或 `logger.*`（浏览器端 `clientCaught`）；代码评审检索 `catch {`、`.catch(() =>`，无日志者须有注释说明调用方已记录。
2. 不向日志传入密钥、令牌、授权码、state/nonce/PKCE、Cookie、会话 ID、邮箱或上游正文；脱敏是兜底，不是许可。
3. 涉及失败路径的修改，测试用 `tests/backend/log-capture.ts` 断言事件与"不泄露"。
4. 上线后用 `npx wrangler tail <worker> --format json` 或控制台 Workers Logs 确认事件按预期出现。
5. 已知限制：Astro 内置 checkOrigin 拦截的跨站表单 POST 在应用中间件之前返回 403，不经统一日志；`auth.google.provider_failed` 暂未携带 requestId，可按时间戳与 `callback_failed` 关联。

## 补充：日志迁移为独立模块（2026-10-27）

**现象**：初版日志代码分散在 `src/server/log.ts`、`src/shared/log-redact.ts`、`src/components/shared/client-log.ts` 三处，没有模块说明，不符合"每个业务模块自带 README"的约定，后来者难以发现规则与 API。

**根因**：初版按调用方位置就近放置，没有作为横切模块设计。

**修复内容（文件）**：

- 迁移为独立目录 `src/modules/log/`：`server.ts`（服务端 logger）、`client.ts`（浏览器日志）、`redact.ts`（脱敏与异常序列化）、`index.ts`（汇总导出），公开 API 不变。
- 新增 [src/modules/log/README.md](../src/modules/log/README.md)：用途与规则、API、级别约定、脱敏与绝不记录的内容、JSON 输出示例、查看日志、新增事件步骤、测试辅助。
- 更新全部导入路径（server、components、modules、tests），以及根 README 索引、`docs/DEVELOPMENT.md`、`docs/DEPLOYMENT.md`、`src/server/README.md` 的引用。

**验证方式与结果**：`npm test`、`npm run check`、`npm run build`、`test:smoke`、`test:worker` 通过（结果见提交说明），重新部署后线上 `/login`、session、start 正常。

**如何避免再次踩坑**：横切能力（日志、度量、协议）新建时即放入 `src/modules/<名称>/` 并附 README；导入按运行端选择 `server.ts` / `client.ts`，不要在业务目录另建同义工具函数。
