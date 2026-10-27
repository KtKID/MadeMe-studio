# 工作台侧边栏显示作者账号名（2026-10-27）

## 现象

工作台左下角“我的站点”下方的账号入口在登录前后都只显示固定文案“作者登录 / 账号与退出”，作者登录 Google 后看不出当前是哪个账号。需求：登录后显示用户账号名。

## 根因

- 会话协议 `GET /api/auth/session` 与工作台 SSR 数据只有 `authenticated` 布尔值，不携带任何身份信息。
- Google 登录只申请 `openid email` scope，ID token 不含 `name`；`google_author_sessions` 只存 token 摘要、配置指纹和时间，没有身份字段。
- 侧边栏在两处渲染：`src/layouts/Studio.astro`（新建/编辑页）与 `src/components/studio/StudioShell.tsx`（四个工作空间深链），都写死文案。

## 方案选择

| 方案                           | 说明                                                                                                                                 | 结论                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 使用服务端已有的 `OWNER_EMAIL` | 单作者模式下会话只会在登录邮箱与 `OWNER_EMAIL` 一致时颁发（Google 校验已验证邮箱，密码模式校验配置邮箱），因此配置值即当前会话账号   | **采用**：无迁移、无新存储         |
| 存储 Google 显示名             | 需新增 `profile` scope（改变授权同意范围）、`google_author_sessions` 新增列（迁移 0004，迁移前须先导出备份 D1），并处理名字变化/为空 | 暂不采用，如需显示名可后续单独评审 |

## 修复内容

- 新增 `src/server/auth/account.ts`：`ownerAccount(env, identity)` 是账号名唯一来源。仅 `identity.owner` 且 `AUTH_MODE` 为 `google`/`password` 时返回规范化（trim+小写）且合法的 `OWNER_EMAIL`；未登录、Sites、本地开发身份、Bearer 令牌、非法配置一律 `null`。
- `src/shared/auth.ts`：会话响应增加可选 `account`（仅已验证作者本人时出现）；新增 `accountInitial()` 生成头像字母。
- `src/server/auth/password.ts` `getAuthPresentation`：已登录时附带 `account`，同时服务 `/api/auth/session`（`private, no-store`）与 `/login`。
- `src/server/page-data.ts`：`StudioPageData.account`；新增 `loadEditorPageData` 供新建/编辑页使用（`loadPageData` 行为与 `/api/bootstrap` 协议不变）。
- 侧边栏（`Studio.astro`、`StudioShell.tsx` 保持同一标记）：
  - 未登录：保持“作者登录 / 账号与退出”。
  - 已登录：首字母圆形头像（复用 `.site-avatar`）+ 账号名（`.author-account-name`，过长省略号，`title` 悬停显示“已登录：<账号>（账号与退出）”）+ 小字“账号与退出”。链接仍到 `/login`，在该页确认退出。
  - `StudioShell` 身份失效（退出/过期）后立即不再显示账号名。
- `/login` 已登录状态显示“已登录：<账号>”。
- 样式：`src/styles/global.css` 新增 `.author-link`、`.author-account`、`.author-account-name`。

## 隐私与日志

- 账号名只出现在作者本人已认证的 no-store 响应和页面中；未登录响应不含 `account` 字段，伪造 `oai-authenticated-user-*` 头无效。
- 本功能没有新的失败路径（纯函数读取配置）；不在任何日志中写入账号邮箱，测试断言 Google 完整登录流程的日志不含该邮箱。

## 验证

- 新增 `tests/ui/author-account.test.tsx`（6 项）：侧边栏登录/未登录/缺账号渲染、登录页账号展示、`ownerAccount` 模式矩阵、头像字母。
- `tests/backend/google-auth.test.ts`：未登录（含伪造身份头）会话精确为 `{mode,configured,authenticated}`；登录后精确含 `account`；退出后消失；日志不含邮箱。
- `tests/backend/author-auth.test.ts`：密码模式登录后含 `account`，无 Cookie 时不含。
- `npm test` 60 文件 428 项通过；`npm run check` 0 错误；build、smoke、worker（仓库 wrangler.jsonc）通过；已部署生产版本 `d4011b0e-7a83-4ede-9abd-59740e43b28a`：`/login` 200（Referrer-Policy same-origin）、未登录 `/api/auth/session` 为 `{"mode":"google","configured":true,"authenticated":false}`（无 `account`）、Google start 303 至 accounts.google.com、未登录 `/studio` 仍显示“作者登录 / 账号与退出”。已登录显示需作者在浏览器中确认。

## 避免再次踩坑

- 侧边栏有两份实现（Astro 与 React），修改账号入口必须同时修改并保持类名一致；测试覆盖 React 版本。
- 任何新的身份展示字段都应经 `ownerAccount` 一类的单一函数，并以 `identity.owner` 为前提，不能从请求头或客户端参数取值。
- 若要显示 Google 显示名：先评审 `profile` scope，再写迁移 0004，执行前按规则导出备份生产 D1。
