# 单文件 Agent Publisher

`SKILL.md` 给 agent 规定授权边界；`publish.mjs` 是可直接运行的 Node CLI。默认只创建草稿，没有目录上传、文件 glob、自动重试或同步服务。

```sh
# Token 通过受保护的环境注入，不要把真实值写进命令历史/脚本
export MADEME_SITE=https://your-site.example
# MADEME_API_TOKEN 由调用环境提供；示例不包含真实 Token

# 先预检：只读取该文件，没有网络，不需要 Token
node integrations/agent-publisher/publish.mjs --file ./article.md --dry-run

# 明确发送单篇草稿；需要 posts:write
node integrations/agent-publisher/publish.mjs --file ./article.md

# 用户明确批准公开发布后，单独操作已有版本；需要 posts:publish
node integrations/agent-publisher/publish.mjs publish \
  --id POST_ID --version 1 --visibility public --confirm-publish
```

可用 `--site` 覆盖 `MADEME_SITE`，`--title` 覆盖第一行 H1/文件名推导的标题。只接受一个明确的 `.md` 或 `.markdown` 普通文件，拒绝符号链接和目录。文件内容（包括 YAML frontmatter）全部进入预览，附件不会被读取。`--dry-run` 输出完整正文到 stdout；若正文敏感，请勿把该输出写入共享日志。

不接受 `--token`，防止把凭据放到进程参数和 shell 历史。Token 只从 `MADEME_API_TOKEN` 取值。成功输出仅含文章 ID、版本、可见性、Studio 地址；失败不输出 Token 或服务器原始正文。网络中断不自动重试，先去 Studio 查证。

仅写 Token 的 API 成功回执只有 `id` / `version`；CLI 通过共同 Zod schema 校验，并把本次请求的明确可见性作为摘要输出，不要求服务器回传私人正文或增加 `posts:read`。是否按预期呈现仍需在 Studio 验收。

发布仅支持明确的 `public` / `unlisted`，不接受一边上传文件一边发布；密码文章在 Studio 设置。`--confirm-publish` 是工具门槛，不替代 agent 获得用户明确授权。要求 Node 22.18+ 与根目录依赖已安装。
