# MadeMe Google 登录迁移排障报告

工程交接　2026 年 10 月 27 日 UTC

> Git 交接更新：Google 登录源码、迁移与测试现随本报告保存在独立分支 `feat/google-auth`。另一台服务器可直接拉取该分支；下文关于未提交工作区和源码 ZIP 的描述保留为打包时的历史记录。分支提交不表示依赖安装、完整测试或部署成功。

```sh
git clone --branch feat/google-auth --single-branch https://github.com/KtKID/MadeMe-studio.git
cd MadeMe-studio
```

## 1 结论与处理顺序

**当前服务器没有完成 Google 登录验证，也没有完成独立 Cloudflare 部署。** Google 单作者认证代码已写入隔离工作区，可以交给下一位开发者审查和继续验证；现阶段只能标记为待审查实现，不能标记为登录可用或生产就绪。

阻塞分为两类：自动执行安装被环境权限检查拒绝；用户手动安装又遇到 npm 官方仓库连接超时或拒绝连接。两者不能混为 Cloudflare 运行时拒绝。换一台具备正常网络和安装权限的服务器可能排除当前阻塞，但尚未验证，不能保证换机必然解决全部问题。

**接手顺序：取得含未提交修改的源码 → 恢复锁定依赖 → 完成测试、类型检查和构建 → 经授权配置真实 OAuth 与目标 Workers → 浏览器与安全验收。** 不要先切换现有预览的认证模式。

### 工程边界

- 仓库：`KtKID/MadeMe-studio`，工程分支 `feat/v1`；`main` 仅为基础版本。
- 精确基线：`d1900e19c260f82d062b243f207389e15083bc9f`。
- 本次工作区：`/workspace/scratch/4859fb17ce30/MadeMe-google-auth`。
- 运行结构：Cloudflare Workers、D1、R2；Astro 7.4.2、React、BlockNote、TypeScript、Zod。
- 原环境运行版本：Node.js 24.22.1、npm 11.9.0。目标服务器使用已获授权安装的 Node.js 24 环境。
- Google 修改尚未提交或推送到 GitHub。仅 clone 远端 `feat/v1` 不会得到这些修改；请使用随附完整源码 ZIP，或在精确基线上应用随附 patch。
- 原 `MadeMe-studio` 工作区另有冻结 QA 改动，未合入本次 Google 工作区；不要混包或把其验证结果算入本报告。

### 当前阻塞的证据与解释

1. `jose ^6.2.13` 已写入 `package.json` 与 `package-lock.json`；npm 元数据步骤成功，但实际安装被执行权限检查拒绝。拒绝理由引用了另一同步任务的禁止安装约束；用户后来明确授权云端继续，仍被拒绝。这是执行环境限制，不是应用在 Cloudflare 上执行失败。
2. 用户终端最初找不到 `npm`。已有二进制位于该环境的 `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin`；修正 PATH 后可以启动 npm。此内部路径不应作为新服务器通用配置。
3. 随后运行 `npm ci --cache /tmp/author-studio-npm` 长时间等待，用户停止操作，并出现 `Exit handler never called`。用户提供的 61 行日志明确记录 `registry.npmjs.org` 上 zod、youch、yargs 等包的 `ETIMEDOUT`、`ECONNREFUSED` 以及 audit 超时。因此不能仅凭最后一条错误归因为 npm 自身 bug；具体网络原因仍待目标环境排查。
4. 当前 `node_modules` 是不完整实体目录，`jose` 为空，`.bin` 缺失。它不能作为依赖已安装的证据，也不应复制到新服务器。

<!-- PAGEBREAK -->

## 2 已有实现与验证边界

以下为源码已实现的设计，不等于真实 Google 或生产 Workers 验收通过。

### Google 单作者认证

- 新增 `AUTH_MODE=google`，采用授权码流程、PKCE S256、state、nonce 和浏览器绑定；仅请求 `openid email`。
- 固定 Google 授权、token 与 JWKS 端点；`jose` 执行 RS256 JWT 签名与声明校验。网络调用限制超时、响应大小及重定向。
- 作者由 `OWNER_EMAIL` 显式白名单绑定；可进一步限定 `OWNER_GOOGLE_SUB`。Gmail 可只配置邮箱，非 Gmail 必须同时配置稳定主体。没有首位访问者认领机制。
- 临时授权流程 10 分钟到期，以原子单次消费防重放。应用会话为 8 小时随机不透明令牌，数据库仅保存令牌哈希；退出撤销，配置轮换使旧会话及待完成流程失效。
- 保留退出及写操作 CSRF 检查，固定 HTTPS `APP_ORIGIN`，认证回调 no-referrer，独立认证页面具备 CSP 防嵌入策略。不持久化 Google access、refresh 或 ID token。
- 追加 `drizzle/0003_google_author_auth.sql`、迁移 snapshot 与 journal，不改写既有迁移。

### 已记录验证结果

| 检查 | 结果 | 如何理解 |
| --- | --- | --- |
| 新增 Google 登录 UI | 15 项通过 | UI 行为验证，不是真实 OAuth |
| UI 与原认证组合回归 | 7 个文件，60 项通过 | 包含上述 UI 结果，不应重复相加 |
| SQLite 迁移 原子消费 协议 | 2 项通过 | 对应 google-auth-storage 测试 |
| Google 响应策略 | 7 项通过 | 对应 google-auth-response-policy 测试 |
| Google JWT 真签名测试 | 收集失败，执行 0 项 | 缺少 jose；不能记为通过 |
| 最后一次整体类型检查 | 6 个错误 | jose 缺失相关 3 个；Astro middleware 类型未生成相关 3 个 |
| Google 改动后的完整构建 | 未执行 | 不存在可据此认定成功的构建结果 |
| 真实 Google 授权 独立部署 | 未执行 | 没有真实 OAuth 凭据或目标部署验收 |

基线此前的 307 项测试通过记录属于基线，不代表 Google 修改后的全部 307 项仍通过。本报告记录既有执行结果；交接时没有重新安装依赖或重跑工程测试。

### 优先审查文件

- 实现与接口：`src/server/auth/google.ts`、`src/server/api.ts`、`src/server/auth/identity.ts`、`src/shared/auth.ts`、`src/server/runtime.ts`。
- 存储与策略：`src/server/db/schema.ts`、`src/server/response-policy.ts`、`drizzle/0003_google_author_auth.sql`、`drizzle/meta/0002_snapshot.json`、`drizzle/meta/_journal.json`。
- UI 与配置：`src/components/auth/LoginPanel.tsx`、`src/pages/login.astro`、`src/layouts/Studio.astro`、`src/layouts/StudioWorkspace.astro`、`.env.example`。
- 运行说明：`docs/DEPLOYMENT.md`、`src/server/auth/README.md`、`tests/worker/README.md`。

<!-- PAGEBREAK -->

## 3 在获授权的新服务器继续验证

### 先取得完整代码

推荐解压 `MadeMe-Google登录源码与排障交接.zip`，进入其中的 `MadeMe-google-auth/`；这里是基线与未提交 Google 修改合并后的完整源码，不必再次应用 patch。确认该目录含 `package.json` 与 `package-lock.json`。包内另有 `source-manifest.json` 供逐文件 SHA-256 核对。

备选路线：先取得 Git 的 `feat/v1`，切换至精确基线 `d1900e19c260f82d062b243f207389e15083bc9f`，再对随附 `google-auth-uncommitted.patch` 执行 `git apply --check`，确认后 `git apply`。交接时已在该精确基线的解压目录验证 `git apply --check` 通过；这不代表功能测试通过。该 patch 仅用于此基线；遇到冲突应停下审查，不强行忽略。随后核对 Google 实现、追加迁移及测试文件均已出现。

不要复制旧 `node_modules`、缓存、数据库、构建目录或私有环境配置；交付 ZIP 不包含这些运行状态。

### 恢复依赖与基础验证

先确认服务器允许访问 npm 官方 registry，并使用该服务器已有、受支持且获授权的网络配置。以下命令在项目根目录执行，不创建云资源或配置真实凭据：

```sh
node --version
npm --version
npm config get registry
npm ping --registry=https://registry.npmjs.org/
npm ci
npm ls jose --depth=0
npm test
npm run check
npm run build
```

逐条执行并记录退出码；前一步失败时先处理，不把后续步骤标记为通过。`npm ping` 成功只证明该次请求可达，不能替代 `npm ci` 完整下载成功。保留锁文件，不以删除锁文件、切换未知镜像、关闭 TLS 校验或提权绕过为修复方案。

若安装失败，保存完整命令、目录、Node/npm 版本、退出码、时间及 npm debug 日志；共享前脱敏。先定位最早的网络或权限错误，再分析末尾 `Exit handler never called`，不要只提交最后一行。

### 单独核验 Google 测试

以下命令便于单独记录新增功能结果，不能替代全量回归：

```sh
npm test -- tests/backend/google-auth.test.ts \
  tests/backend/google-auth-security.test.ts \
  tests/backend/google-auth-storage.test.ts \
  tests/google-auth-response-policy.test.ts \
  tests/ui/google-auth-clicks.test.tsx
```

确认真 RSA 签名测试实际执行，而非收集失败或零用例；审查 issuer、audience、nonce、azp、过期、错误签名、非作者拒绝、CSRF、重复与并发回调、退出及配置轮换。

### 构建后运行隔离 Worker 测试

```sh
npm run test:smoke
npm run test:worker
```

按 `tests/worker/README.md` 串行运行，预留回环端口 4321 和 4322，不必预先启动开发服务。脚本自动准备临时本地 D1/R2、应用迁移、运行后清理，不使用远程数据库。通过仅证明相应本地 Worker HTTP 流程，不等于真实 Google 浏览器授权或生产部署通过。

<!-- PAGEBREAK -->

## 4 真实 OAuth 与上线验收

### 仅在取得部署与凭据配置授权后执行

1. 为目标站点确认固定 HTTPS `APP_ORIGIN`，只包含 origin，不带路径或尾斜线。创建真实 Google Cloud Web OAuth 客户端，准确登记 `${APP_ORIGIN}/api/auth/google/callback`，只使用 `openid email` scope。
2. 通过部署平台私有变量与 Secrets 配置 `AUTH_MODE=google`、`APP_ORIGIN`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`OWNER_EMAIL` 和不少于 32 字符的随机 `SESSION_SECRET`；按邮箱类型及绑定策略配置 `OWNER_GOOGLE_SUB`。实际作者邮箱由用户单独提供，不能预填为测试身份。真实密钥不进入聊天、源码、前端包或日志。
3. 经授权连接用户自己的 Cloudflare 账户，确认目标 D1、R2 与绑定。先备份现有数据库，核验并应用追加迁移；`wrangler.jsonc` 中现有数据库 ID 是占位符，不能直接当作生产资源。构建本身不会替独立目标数据库执行迁移。
4. 部署后用真实浏览器完成作者授权与回调，再检查非作者拒绝、取消授权、退出后会话撤销、过期、CSRF、重放与并发回调、配置轮换、错误配置失败关闭。记录实际 URL、部署版本、时间与结果，不记录授权码或 token。

### 当前未做的操作

没有创建真实 OAuth client secret，没有登录 Cloudflare 账户，没有创建云资源，也没有启用独立 Google 部署。现有 Sites 私有预览仍保留原 05:33 runtime，认证模式和访问权限未更改。预览可访问不等于 Google 登录可用。

### 交接完成标准

- [ ] 在干净目录完整安装锁定依赖，`npm ls jose --depth=0` 成功，依赖树不再残缺。
- [ ] Google 真签名与安全套件实际执行，所有必要用例通过；全量回归结果重新记录。
- [ ] `npm run check` 无错误，`npm run build` 成功，隔离 smoke 与 worker 测试通过。
- [ ] 真实 Google Web OAuth 客户端和精确回调完成配置，作者与非作者实际浏览器验收完成。
- [ ] 用户自有 Cloudflare 部署、迁移、绑定、备份恢复与会话安全验收完成。
- [ ] 仅在上述结果有证据后，才将状态从待验证改为可部署或已上线。

### 证据与交接资料

源码基线与工作区状态、`package.json`、锁文件、Google 实现及测试路径如前述。安装故障依据用户提供的 npm debug 日志附件；日志时间标识为 `2026-10-27T06_17_33_485Z`。原日志位于用户终端 `/tmp/author-studio-npm/_logs/`，云端无法直接读取该路径，已读取其附件副本。包内 `npm-install-error-excerpt.txt` 保留该日志片段，便于下一位开发者核对网络错误，而不是凭最后一行推断根因。

本报告仅交接 Google 认证工作区，不包含真实凭据、作者邮箱、运行数据库或旧服务器依赖目录。下一步最有价值的结果，是在新服务器证明依赖安装、真实 JWT 测试、类型检查和构建是否能完整通过，再决定是否进入授权部署。
