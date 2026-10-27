# 统一日志模块

服务端与浏览器共用的日志与脱敏模块。目标是**失败不得静默**：任何被捕获的异常、被转换为响应或默认值的失败，都必须经本模块留下可检索、不泄密的记录。

## 规则

- 服务端一律使用 `server.ts` 的 `logger.*` / `logCaught`，浏览器端使用 `client.ts` 的 `clientLog` / `clientCaught`；不直接 `console.*`，不写空 catch，不用 `.catch(() => 默认值)` 吞错。
- 纯判定函数（如 URL 解析失败返回 `false`）可以不记录，但须注释说明由调用方返回错误并经 `errorResponse` 记录。
- 脱敏是兜底而非许可：不要主动传入下文"绝不记录"的内容。
- 每次修复须在 [reports/](../../../reports/README.md) 新增报告。

## 文件

| 文件        | 运行端         | 职责                                          |
| ----------- | -------------- | --------------------------------------------- |
| `server.ts` | Workers / Node | 结构化 JSON 行日志、`logCaught`、请求关联     |
| `client.ts` | 浏览器         | 控制台日志（`[mademe]` 前缀），不上报外部服务 |
| `redact.ts` | 共用           | 强制脱敏与异常序列化                          |
| `index.ts`  | 共用           | 汇总导出；业务代码优先按运行端导入具体文件    |

只依赖 Web 标准 API（`console`、`crypto.randomUUID`），不依赖 Cloudflare 或 Node 专有模块。

## API

```ts
import { logger, logCaught, requestLogContext } from "../modules/log/server";

logger.info("media.uploaded", { mediaId, size });
logger.warn("auth.google.provider_failed", {
  endpoint: "token",
  httpStatus: 400,
});

try {
  await work();
} catch (error) {
  logCaught("media.rollback_failed", error, { mediaId }); // 默认 error 级别
  throw error;
}

// 请求关联：requestId 优先取 cf-ray，否则随机 UUID；path 不含查询串
logCaught("page.media_load_failed", error, requestLogContext(request));
```

```ts
import { clientLog, clientCaught } from "../../modules/log/client";

clientLog("warn", "api.request_failed", { path, status, code });
clientCaught("studio.identity_recheck_failed", error); // 默认 warn 级别
```

- `log(level, event, fields)`：底层函数，`logger.debug/info/warn/error` 为其快捷方式。
- `logCaught(event, error, fields = {}, level = "error")`：catch 块专用，附带序列化异常；error 级别附带脱敏后的堆栈。
- `requestLogContext(request)` → `{ requestId, method, path }`。
- `redact(value)`、`serializeError(error, { stack })`、`scrubString(text)`：可单独用于需要脱敏的场景。

## 级别约定

| 情况                                         | 级别  | 内容                         |
| -------------------------------------------- | ----- | ---------------------------- |
| 401 / 403 / 429 等预期拒绝                   | warn  | 状态码与固定错误码           |
| 其它预期 4xx（404、409、415、422 校验失败）  | info  | 错误码；校验失败只记字段路径 |
| 5xx、意外异常、上游/提供方失败、数据回滚失败 | error | 序列化异常（含脱敏堆栈）     |
| 诊断性、可忽略的降级（如性能采样存储不可用） | debug | 事件名与异常类型             |

`src/server/http.ts` 的 `errorResponse` 已按上表统一记录 API 异常（事件 `request.rejected` / `request.app_error` / `request.unhandled_error`），`src/middleware.ts` 记录页面渲染的未处理异常（`request.unhandled_exception`）后再抛出。

## 脱敏与绝不记录的内容

绝不记录：密钥与 client secret、API Key、访问/ID/刷新令牌、OAuth 授权码、state、nonce、PKCE verifier/challenge、Cookie、Authorization 头、会话 ID、密码与摘要、邮箱地址、上游提供方响应正文、完整请求 URL 查询串。

`redact.ts` 的兜底规则：

- **敏感键名整体替换为 `[REDACTED]`**：secret、token、passw、authorization、cookie、`code`、auth_code、state、nonce、verifier、challenge、session、api_key、credential、private、signature、email、`body`、`raw`、response_body、provider_body、`sub`、ticket、jwt、bearer、hash 等（大小写不敏感）。例外：`code` 的值为固定大写常量（如 `CSRF_REJECTED`）时保留。
- **字符串值擦除**：邮箱 → `[EMAIL]`，`Bearer xxx`，JWT → `[JWT]`，`code=`/`state=`/`token=` 等查询参数值，`mm_`/`sk_`/`ghp_` 等令牌 → `[TOKEN]`，32 位以上十六进制与 40 位以上随机串。
- **结构上限**：深度 4、数组 20 项、对象 40 键、字符串 500 字符；`Request`/`Response`/`Headers` 不展开。
- **异常序列化**：只保留 name、擦除后的 message、固定大写 `code`、数字 `status`、可选堆栈与两层 cause；AppError 的 `details` 不展开。

## 输出格式

服务端每条日志是一行 JSON，可被 Workers Logs 与 `wrangler tail` 直接解析为字段：

```json
{
  "level": "error",
  "event": "auth.google.callback_failed",
  "ts": "2026-10-27T09:09:23.840Z",
  "requestId": "a5108fc65a9c1750",
  "method": "GET",
  "path": "/api/auth/google/callback",
  "stage": "token",
  "outcome": "google_failed",
  "errorName": "AppError",
  "errorCode": "GOOGLE_UNAVAILABLE"
}
```

浏览器端输出为 `console.<level>("[mademe]", { event, ...fields })`。

## 查看日志

- 实时：`npx wrangler tail <worker-name> --format pretty`，或 `--format json` 后按 `event`、`level` 筛选。`--status error` 只筛以异常结束的请求，与日志级别无关。
- 历史：`wrangler.jsonc` 已开启 `observability.enabled`，在 Cloudflare 控制台 Workers → 对应 Worker → Logs 按字段查询。
- tail 输出含请求 URL，保存或转发前去掉查询串，不要提交到仓库。

## 新增日志事件

1. 事件名采用 `模块.动作_结果` 小写点分，例如 `media.rollback_failed`、`ai.provider_http_error`。
2. 只放安全的诊断字段：阶段、主机名、HTTP 状态、固定错误码、资源 ID、计数、耗时。
3. 按上表选择级别；catch 中优先 `logCaught`，并保持原有的对外响应不变。
4. 补测试：断言事件出现且不含敏感值。

## 测试

- `tests/unit/log.test.ts`：格式、级别、各类敏感字段脱敏、字符串擦除、异常序列化、`errorResponse` 级别、典型 catch 路径与浏览器 `api()` 失败路径。
- `tests/backend/log-capture.ts`：`captureLogs()` 按时间顺序捕获 console，提供 `records()`、`find(event)` 与 `raw()`（用于断言不泄露），测试结束由 `vi.restoreAllMocks()` 还原。

```ts
const logs = captureLogs();
// ... 触发失败路径
expect(logs.find("auth.google.callback_failed").at(-1)).toMatchObject({
  stage: "token",
});
expect(logs.raw()).not.toContain(secretValue);
```
