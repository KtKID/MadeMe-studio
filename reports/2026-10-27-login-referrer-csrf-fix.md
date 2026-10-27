# 修复报告：/login 点击「Google 登录」返回 403 CSRF_REJECTED

日期：2026-10-27（UTC+8）　分支：`feat/google-auth`　部署版本：`57a3b51f-9843-4ce2-839a-bdf37c8a4713`（后续被 `581ee00f-6a39-44c5-85c4-7922a23f2acd` 覆盖，修复保留）

## 现象

生产 Worker（`https://author-studio.14ktkid12.workers.dev`）首次部署后，在 `/login` 点击「Google 登录」，浏览器 POST `/api/auth/google/start` 得到 `403 {"error":{"code":"CSRF_REJECTED"}}`，无法跳转到 Google。用 curl 携带正确 `Origin` 的请求却返回 303，问题只在真实浏览器出现。

## 根因

`src/server/response-policy.ts` 对 `/login` 页面也下发了 `Referrer-Policy: no-referrer`。按 Fetch 规范，当文档的 referrer policy 为 `no-referrer` 时，浏览器对原生表单 POST 发送 `Origin: null`。`assertSameOrigin`（`src/server/auth/identity.ts`）正确地拒绝 `null` Origin，于是 start 请求被判为跨站请求。

## 修复内容（文件）

- `src/server/response-policy.ts`：Referrer-Policy 按路径区分。`/api/auth/*`（303 跳转与回调 URL 带 code/state）仍为 `no-referrer`；`/login` 改为 `same-origin`（同源表单 POST 携带真实 Origin，跨站导航仍不泄露 Referer）；其它页面为 `strict-origin-when-cross-origin`。
- `src/server/auth/README.md`：说明两种策略的分工与原因。
- `tests/google-auth-response-policy.test.ts`：google / password / sites 三种模式下 `/login` 均断言 `same-origin`；start、session、logout 断言 `no-referrer`。
- `tests/backend/google-auth.test.ts`：start 携带 `Origin: null` 必须 403 `CSRF_REJECTED`，且不发起任何 Google 请求。
- **未放宽** `assertSameOrigin`：仍拒绝 `null` Origin。

## 验证方式与结果

- Google 相关 5 个测试文件、完整 `npm test`、`npm run check`、`npm run build`、`test:smoke`、`test:worker` 全部通过（smoke/worker 使用仓库原始 `wrangler.jsonc`）。
- 线上：`GET /login` 响应头 `Referrer-Policy: same-origin`；同源 start → 303 到 `accounts.google.com`，参数正确且响应为 `no-referrer`；`Origin: null` → 403 `CSRF_REJECTED`；跨站 Origin → 403。
- 无头 Chrome 打开 `/login` 点击按钮：start 请求携带真实 Origin → 303，落到 Google 账号选择页，未向 Google 发送 Referer，无 `redirect_uri_mismatch`。

## 如何避免再次踩坑

1. **安全头会改变浏览器请求本身**。`Referrer-Policy`、CSP `form-action`、`Sec-Fetch-*` 等变化必须用真实浏览器（或至少按规范构造 `Origin: null` 的测试）验证，curl 手工带 Origin 的测试会掩盖这类问题。
2. 承载表单的页面不要使用 `no-referrer`；需要隐藏敏感 URL 的只有携带 code/state 的跳转与回调响应。
3. 已加入回归测试：`/login` 策略断言 + `Origin: null` 必须被拒绝。修改 `response-policy.ts` 时必须同时跑 `tests/google-auth-response-policy.test.ts` 与 `tests/backend/google-auth.test.ts`。
