# 真实 MadeMe API 端到端验收

本清单可指向自有预发布或正式 MadeMe API。它与 `transport.e2e.node.mjs` 的本地协议夹具测试不同：**执行写入步骤会在目标站点真实创建草稿**。没有经过授权的站点与 Token 时，不执行这些步骤，也不声称真实 E2E 通过。

## 前提与边界

1. 由用户/运维确认站点、允许写入测试草稿、清理责任人。优先测试站点；正式站点只用本目录公开安全的夹具，不用私人笔记。
2. 根项目依赖已安装，Node 22.18+；API/D1 迁移、owner 配置已完成；Studio 可正常访问。
3. 由 owner 在 Studio → Integrations 准备短有效期、仅 `posts:write` 的测试 Token。通过执行环境的安全变量设置 `MADEME_API_TOKEN`。不要把真实 Token 写在下面命令中、聊天、仓库或日志。此清单不会自动创建 Token。
4. `MADEME_SITE` 使用目标原点，例如 `https://your-site.example`。它不是 `/studio` 地址。不把跨站跳转视为可接受配置。

## A. 预检：无网络、无写入

```sh
set +x
export MADEME_SITE=https://your-site.example
node integrations/agent-publisher/publish.mjs \
  --file integrations/tests/fixtures/publish-smoke.md --dry-run
```

检查 endpoint 为已批准的 `/api/posts`，`requiredScope` 为 `posts:write`，正文为夹具原文，`visibility` 必须是 `draft`。该夹具无敏感内容；真实私密笔记的 dry-run 输出不可进入共享日志。

## B. 真实保存草稿

获得目标写入授权后执行一次：

```sh
node integrations/agent-publisher/publish.mjs \
  --file integrations/tests/fixtures/publish-smoke.md \
  --title "MadeMe integration acceptance draft"
```

预期退出码 0，输出 JSON 包含文章 `id`、正整数 `version`、`visibility:"draft"` 与目标 `studioUrl`，不包含 Token。记录该 ID 和版本，**不自动重试**。连接中断/超时先去 Studio 核实是否已落库，避免重复草稿。

注意：仅写 Token 的 HTTP 响应为 `{post:{id,version}}`，不回显私密文章元数据；CLI 中 `visibility:"draft"` 是本次请求的摘要，不是额外读取结果。不应为验收扩大 Token 到 `posts:read`；正文核验使用 owner 的 Studio 会话完成。

用 owner 身份进入 Studio：

- 同一 ID 的文章存在且仍是草稿；标题、列表、引用、代码块已转换为可编辑 BlockNote 内容。
- 在匿名窗口查看文章列表、搜索和 RSS：夹具草稿不应出现；不能通过公开地址读取其正文。
- 在 Studio 修改后保存，版本应变化；记录新的版本，后续发布不得使用被更改的旧版本。

## C. 可选：独立发布链路

**仅在用户另行批准发布该公开安全夹具时执行。** 使用被批准的 `public` 或 `unlisted` 可见性，精确记录待发布版本。先做无写入预览：

```sh
node integrations/agent-publisher/publish.mjs publish \
  --id POST_ID --version REVIEWED_VERSION --visibility unlisted \
  --confirm-publish --dry-run
```

有明确授权且安全环境已提供具备 `posts:publish` 的 Token 后，去掉 `--dry-run` 进行一次真实发布。预期 API 返回该可见性；匿名窗口能访问指定文章，`unlisted` 不进入公开列表。旧版本应返回 409 并要求重新审阅，不能静默覆盖为最新版本。`--confirm-publish` 不代替用户授权。

权限负例优先在隔离测试站点执行：验证仅 `posts:write` 的 Token 发布被拒绝（403），无效/过期/撤销 Token 被拒绝（401）；不能拿未知 scope 的真实 Token 猜测负例，以免意外发布。

## D. 真实扩展与 Obsidian

复用同一已授权站点，但每个工具用独立的 `posts:write` Token，方便撤销和审计。按 [人工 E2E 检查表](README.md) 执行取消、拒绝权限、重复点击、关闭与重开、网络失败、Token 撤销等流程。Chrome 只能人工加载；Obsidian 只用测试 vault。不能从 CLI 成功推断两个宿主都成功。

## E. 证据与清理

记录时间、版本/commit、目标 origin、文章 ID、通过项/失败项、HTTP 状态、是否完成清理。证据中不保存 Token，不录制含凭据的设置页。清理包括在 Studio 撤下并移除测试文章、撤销测试 Token、Chrome Forget connection、Obsidian Forget token；已发出的请求不能靠关闭工具撤销。

本次云端已完成的是本地协议夹具 E2E；真实目标 API、Chrome 扩展宿主和 Obsidian 宿主的状态须根据实际执行另行填写。
