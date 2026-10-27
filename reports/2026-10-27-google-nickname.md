# 侧栏改为显示 Google 昵称（2026-10-27）

## 现象

上一版侧栏登录后显示作者邮箱（`OWNER_EMAIL`）。作者要求改为显示 Google 昵称。

## 根因

- Google 授权只申请 `openid email`，ID token 不含 `name` 声明。
- `google_author_sessions` 没有身份展示字段；会话查询只返回布尔值，昵称无处保存也无处读取。

## 修复内容

- **授权范围**：`src/server/auth/google.ts` scope 改为 `openid email profile`（仅用于 `name`，仍不申请 offline 或任何 Google API 权限）。
- **声明读取与清洗**：`googleIdentityClaimsSchema` 增加可选 `name`（`unknown`，异常类型不阻止登录）。`src/shared/auth.ts` 新增 `sanitizeDisplayName`：限定读取 1024 字符、NFC 规范化、空白折叠为单个空格、移除控制/格式（双向覆盖、零宽）/私用/未分配字符、按码点截断到 64；空结果为 null。
- **存储**：迁移 `drizzle/0004_google_session_display_name.sql` 给 `google_author_sessions` 追加可空 `display_name`（同步 `schema.ts`、`meta/_journal.json`）；回调在签发会话时写入清洗后的昵称。不保存任何 Google 令牌。
- **读取**：新增 `googleSession()` 一次查询返回有效会话及昵称（读出时再清洗一次），`googleSessionOwner` 复用它；`Identity.displayName` 只在 Google 作者会话中填充。
- **展示**：`src/server/auth/account.ts` 新增 `ownerDisplayName`（仅 Google 模式已验证作者）；`/api/auth/session` 与 `/login` 附带 `accountName`；工作台与编辑器 SSR 数据附带 `accountName`。`accountPresentation()` 统一规则：**昵称 > 邮箱**，悬停提示“已登录：昵称（邮箱）（账号与退出）”；头像字母支持中文等 Unicode 字母。`Studio.astro`、`StudioShell.tsx`、`LoginPanel.tsx` 同步。
- **回退**：迁移前登录的旧会话 `display_name` 为 NULL → 显示邮箱，**需退出并重新登录**才会显示昵称。Google 未提供昵称时同样回退邮箱。密码模式始终只显示邮箱。

## 隐私与日志

- 昵称、邮箱只出现在作者本人的 `private, no-store` 响应/页面中；未登录、伪造身份头、Bearer 令牌都不返回。
- 不新增日志事件；会话写入失败仍由 `auth.google.callback_failed`（stage=session）记录固定字段。测试断言完整登录流程日志不含昵称与邮箱。

## Google Auth Platform 同意屏幕

`openid`、`email`、`profile` 是 Google Sign-In 的非敏感基础范围：无需应用验证；Testing 状态下这些范围也不受测试用户名单与 7 天过期限制。因此**无需修改同意屏幕即可生效**；如需让“数据访问”列表与实际一致，可在控制台可选地添加 `.../auth/userinfo.profile`（不影响登录）。首次以新范围登录时 Google 可能再次显示同意页，属正常。

## 生产迁移与备份

1. 备份：`wrangler d1 export author-studio --remote --output /workspace/.secrets/d1-backup-<时间>.sql`，权限 600，不入库。
2. `wrangler d1 migrations apply author-studio --remote` 应用 0004（追加可空列，旧代码不受影响）。
3. 先迁移、后部署：新代码查询 `display_name`，反序会导致会话查询失败。

## 验证

- `tests/backend/google-auth.test.ts`：scope 含 profile；昵称清洗（双向覆盖、NUL、换行、全角、超长截断 64 码点）后存库并返回 `accountName`；旧会话（NULL）仅返回 `account`；未登录不返回；异常类型昵称不阻止登录；日志不含昵称/邮箱。
- `tests/backend/google-auth-storage.test.ts`：表结构包含 `display_name`。
- `tests/ui/author-account.test.tsx`：昵称优先渲染与悬停提示、未登录不泄露、`ownerDisplayName` 模式矩阵、清洗规则、中文头像字母。
- 结果见下方“部署记录”。

## 避免再次踩坑

- 新增展示字段必须走单一函数（`ownerAccount` / `ownerDisplayName`）并以 `identity.owner` 为前提。
- 外部提供的显示文本一律经 `sanitizeDisplayName` 一类函数清洗、限长；读出时再清洗，防止历史脏数据。
- 读取新列的代码必须在生产迁移之后部署；迁移前先导出备份。

## 部署记录

- 本地：`npm test` 60 文件 433 项通过；`npm run check` 0 错误 0 警告；build、smoke、worker（仓库 wrangler.jsonc，本地迁移含 0004）通过。
- 生产备份：`/workspace/.secrets/d1-backup-20261027-174443.sql`（600，不入库）。
- 生产迁移：`0004_google_session_display_name.sql` 已应用，`google_author_sessions` 列含 `display_name`。
- 生产版本：`e79b4a3e-f857-4339-a4f5-3419f5c705b8`。线上检查：`/login` 200；未登录 `/api/auth/session` 为 `{"mode":"google","configured":true,"authenticated":false}`；Google start 303，`scope=openid email profile`。
- 作者需退出后重新登录，侧栏才显示昵称。
