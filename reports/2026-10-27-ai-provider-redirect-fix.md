# 修复报告：AI 文本/图片提供商请求使用 `redirect: "error"`，在 Workers 上必然失败

日期：2026-10-27（UTC+8）　分支：`feat/google-auth`（未提交）　部署版本：`3f67ea2e-cab1-4977-a3e6-047584a08c1b`

## 现象

修复 Google 回调时（见 [2026-10-27-google-callback-redirect-fix.md](2026-10-27-google-callback-redirect-fix.md)）发现同类隐患：`src/server/ai/transport.ts` 与 `src/server/ai/images.ts` 的 `fetch` 也传 `redirect: "error"`。生产环境未配置模型密钥，尚无用户可见故障；一旦配置，所有 AI 文本、模型发现与生成图片下载都会返回 `PROVIDER_UNAVAILABLE` / `IMAGE_DOWNLOAD_FAILED`，且原先 catch 不记录任何日志。

## 根因

workerd 只支持 `redirect: "follow" | "manual"`，`"error"` 在构造请求时即抛 `TypeError: Invalid redirect value ...`（已在 Google 修复中于真实 workerd 复现）。原 catch 把该异常转换为 502 并丢弃原始错误，测试中的 fetch 模拟又断言 `redirect` 为 `"error"`，把平台不兼容固化成了"期望行为"。

## 修复内容（文件）

- `src/server/ai/transport.ts`：`redirect: "manual"`；`!response.ok` 已拒绝任何非 2xx（含 3xx），不跟随跳转、不向其它主机转发密钥。网络异常记录 `ai.provider_fetch_failed`（主机名 + 脱敏异常），非 2xx 记录 `ai.provider_http_error`（主机名、HTTP 状态、是否为重定向；429 为 warn，其余 error），不读取上游正文。
- `src/server/ai/images.ts`：生成图片下载同样改为 `"manual"`；记录 `ai.image_download_failed` / `ai.image_download_http_error`（仅主机名与状态码，不含带签名的查询串）。
- `src/server/ai/README.md`：记录 Workers redirect 限制与日志事件。
- `tests/backend/ai.test.ts`：原断言 `"error"` 改为 `"manual"`；新增 5 项：模拟 workerd redirect 校验的 fetch 下文本请求成功；提供商 302 → `PROVIDER_ERROR`、只调用一次且日志不含密钥或跳转目标；网络异常写 `ai.provider_fetch_failed`；上游 500 只记录状态码不记录正文；图片下载 301 → `IMAGE_DOWNLOAD_FAILED`、不写 R2、日志不含签名。

## 验证方式与结果

- `tests/backend/ai.test.ts` 与 `tests/unit/log.test.ts` 共 66 项通过；完整 `npm test` 59 个文件 422 项通过；`npm run check` 0 错误；`npm run build`、`test:smoke`、`test:worker` 通过。
- 生产构建产物 `dist/server` 中已无 `redirect: "error"`。
- 生产未配置模型密钥，线上无法直接调用 AI；平台兼容性由 Google 修复中的 workerd 探针（同一 fetch 约束）与新增的 workerd 约束测试覆盖。

## 如何避免再次踩坑

1. 全仓库检索：`rg 'redirect:\s*"error"' src` 应为空；新增 Worker 内 fetch 时只用 `"manual"`（禁止跟随）或 `"follow"`。
2. fetch 模拟测试应模拟平台约束（对非 follow/manual 抛 TypeError），不要断言平台不支持的取值。
3. 发现一个平台差异 bug 时，立即全局搜索同类用法，而不是只修当前路径。
