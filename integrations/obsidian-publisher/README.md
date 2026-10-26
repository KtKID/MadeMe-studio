# MadeMe Obsidian Publisher

仅发送当前打开的 Markdown 笔记（包括编辑器未落盘的当前内容）。打开预览后，显示完整发送正文和目标站点；用户再次确认才创建草稿。无仓库枚举、定时同步、双链追踪或附件上传。

## 构建

```sh
# 仓库根目录，esbuild 使用根依赖
node integrations/obsidian-publisher/esbuild.config.mjs

# 独立类型检查（需要本模块开发依赖）
cd integrations/obsidian-publisher
npm install
npm run check
```

构建输出 `dist/main.js`、`dist/manifest.json`、`dist/styles.css`。人工测试时将三者复制到**专门的测试 vault** 中 `.obsidian/plugins/mademe-publisher/` 并手动启用。此次不会访问用户私人 vault 或自动安装插件。

设置页保存站点原点；Token 仅保留在当前 Obsidian 会话内存，重启后需要重输，不写到 vault 的 `data.json` 或同步目录。使用 `posts:write` Token。站点变化需重新输入 Token。

命令面板执行 “Preview current note as MadeMe draft”，审阅标题、完整原文（包括 frontmatter）和目标，然后勾选确认并点击保存。正文中的 YAML、个人信息、链接都按预览发送，不会私自删掉；请自行审阅。插件不自动转换 wikilink，也不上传链接到的笔记或附件。

网络使用浏览器 fetch 的 no-cookie/no-redirect 模式和服务器 Bearer CORS 支持；不借由 `requestUrl` 绕过重定向限制。关闭模态框不能撤回已经发送的请求；发生超时先检查 Studio。真实 Obsidian 桌面/移动端联调仍需人工检查，不从打包成功推断运行成功。

参考官方 [插件示例](https://github.com/obsidianmd/obsidian-sample-plugin) 与 [API 声明](https://github.com/obsidianmd/obsidian-api)。
