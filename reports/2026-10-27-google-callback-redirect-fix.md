# 修复报告：Workers 上 fetch `redirect: "error"` 导致 Google 回调恒为 google_failed

日期：2026-10-27（UTC+8）　分支：`feat/google-auth`　部署版本：`581ee00f-6a39-44c5-85c4-7922a23f2acd`　**用户已于 2026-10-27 在该版本上以站点所有者账号成功完成 Google 登录。**

## 现象

修复 Referrer-Policy 后，浏览器可以到达 Google 并选择所有者账号，但回调 `/api/auth/google/callback` 总是 303 到 `/login?error=google_failed`，无法进入 `/studio`。D1 中对应的 OAuth flow 行已被消费（说明 state/cookie 校验通过），失败发生在其后。单元测试全部为绿。

## 根因

`src/server/auth/google.ts` 的 `providerJSON` 调用 `fetch(url, { redirect: "error" })` 访问 Google token 端点与 JWKS。Cloudflare workerd 只支持 `"follow"` 和 `"manual"`，传入 `"error"` 会在发出任何网络请求前直接抛出：

```
TypeError: Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).
```

该异常被回调的 catch 统一转换为 `google_failed`，且当时没有任何日志，所以线上看不到原因。单元测试用 `vi.fn` 模拟 `fetch`，不会校验 `init.redirect`，因此 Node 下测试通过、workerd 下必然失败。

### 复现证据

在真实 workerd（`wrangler dev --local`，workerd 1.20261023）中运行一次性探针 Worker：调用真实 `handleGoogleAuth` 走 start → callback，使用本地 D1（迁移 0001–0003），fetch 桩先用 workerd 自身的 `new Request(url, init)` 校验 `init`，再返回 RS256 令牌与 JWKS。结果（`/workspace/mm-fix/workerd-probe-result.json`）：

| 版本           | 回调结果                     | 会话 Cookie | 实际发出的 fetch                                 |
| -------------- | ---------------------------- | ----------- | ------------------------------------------------ |
| 原 `google.ts` | `/login?error=google_failed` | 无          | 无（构造请求即抛 TypeError）                     |
| 修复后         | `/studio`                    | 已设置      | token `redirect=manual`、certs `redirect=manual` |

另在 workerd 中对真实网络探测：googleapis certs 使用 `manual` → 200、2 个 key；token 端点使用 `manual` 配合伪造 code → 真实 400。探针文件已删除。

## 修复内容（文件）

- `src/server/auth/google.ts`：`redirect: "manual"`；任何非 2xx 状态（**包括 3xx**）都视为失败，从而保持"不跟随跳转到其它主机"的安全意图。回调按固定阶段记录 `stage`（flow、provider_error、code、token、jwks、verify、claims、binding、owner、session），catch 中只记录阶段名，不记录 code、token、email、state 或提供商错误正文。
- `src/server/auth/README.md`：记录 Workers 的 redirect 限制与"仅记录阶段"日志约定。
- `tests/backend/google-auth.test.ts`、`tests/backend/google-auth-security.test.ts`：fetch 模拟断言 `redirect` 为 `"manual"`；新增：成功流程只使用 follow/manual；token 端点返回 302 → google_failed 且日志阶段为 `token`，日志不含 state、code、email；JWKS 500 → `jwks`；错误密钥签名 → `verify`。

## 验证方式与结果

- Google 相关 5 个文件 75 个测试通过；完整测试 58 个文件 382 个测试通过；`npm run check` 0 错误；`npm run build` 成功；`test:smoke`、`test:worker` 通过（使用仓库原始 `wrangler.jsonc`，生产配置随后恢复并核对 D1 ID 与 vars）。
- 线上（版本 `581ee00f`）：`/login` 为 same-origin；session 端点 `configured:true`；start 303 到 Google；`Origin: null` → 403；`POST /api/posts` 未登录 → 401。
- `wrangler tail`：真实 start + `code=bogus` 回调 → `/login?error=google_failed`，日志为 `google_callback_failed {stage:"token"}`，证明 token 请求已真实发出（Google 返回 invalid_grant 400），无未处理异常。
- **用户于 2026-10-27 在版本 `581ee00f` 上以所有者账号完成真实 Google 登录。**

## 如何避免再次踩坑

1. **模拟 fetch 会隐藏 workerd 专有行为**。凡是在 Worker 中调用 `fetch` 的代码，不得使用 `redirect: "error"`；统一使用 `"manual"` 并显式把 3xx 当作失败。测试中的 fetch 模拟应断言 `init.redirect` 取值在 `"follow" | "manual"` 内，最好用 `new Request(url, init)` 校验 init。
2. 涉及外部 HTTP、Web Crypto、流处理的改动，除 Vitest 外必须在 workerd 中验证（`npm run test:worker`，或在仓库外临时目录用 `wrangler dev --local` 运行探针，仓库内运行会与 Astro 生成的配置冲突）。
3. **失败不能静默**：回调 catch 原先不记录任何信息，导致线上只能看到 google_failed。此后所有 catch 必须通过统一日志接口记录（不含敏感数据），并用 `npx wrangler tail` 验证。
4. **同类遗留问题**：`src/server/ai/transport.ts`（约第 46 行）与 `src/server/ai/images.ts`（约第 125 行）同样使用 `redirect: "error"`，在 Workers 上所有 AI 文本与图片提供商调用都会抛出同一 TypeError。此提交不含该修复，将在下一项工作（统一日志改造）中一并修复并补测试。
