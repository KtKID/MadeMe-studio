# MadeMe Obsidian Publisher

仅发送当前打开的 Markdown 笔记快照（包括编辑器未落盘的内容）及其明确引用的媒体附件。打开预览后显示完整发送正文和目标站点；用户再次确认才读取并上传附件、创建私有草稿。没有定时同步，不追踪或上传其它笔记。

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

设置页保存站点原点；Token 仅保留在当前 Obsidian 会话内存，重启后需要重输，不写到 vault 的 `data.json` 或同步目录。草稿需要 `posts:write`；含附件另需 `media:write`。站点变化需重新输入 Token，不自动扩大权限。

命令面板执行 “Preview current note as MadeMe draft”，审阅标题、完整原文（包括 frontmatter）和目标，然后勾选确认并点击保存。本轮不新增 YAML 属性、时间、天气映射。标准 Markdown 图片及 `![[图片/视频/动图]]` 由[共享附件模块](../../src/modules/markdown-import/README.md)解析：先枚举 vault 文件路径/大小/修改时间元数据用于路径与同名检查，不读取其它笔记正文；仅顺序读取→上传本篇引用的附件，然后替换 URL 并按真实 MIME 转成 image/video/audio/file 块。双链笔记不上传，同名有歧义、越界、缺附件、文件读取期间变动、不支持格式明确失败，不静默丢引用。

GIF 原件保留动画；MP4/WebM/MOV 原件保留，能否播放取决于编码与浏览器。已测合成 H.264 MP4/MOV 的 Chromium 播放，不保证 HEVC/ProRes。图片继续走现有服务端处理；插件不具有网页 Canvas 大图预缩小能力，超出服务端限制会失败。已有 HTTPS/本站文件 URL 不重复上传。

失败/取消保留原笔记；同一次预览重试会复用已上传附件，缓存只留 URL/元数据，不预加载整库二进制。已经上传的媒体不会因关闭窗口而删除。网络超时可能已创建草稿，先查 Studio 后手动决定重试，不自动重发文章 POST。

网络使用浏览器 fetch 的 no-cookie/no-redirect 模式和服务器 Bearer CORS 支持；不借由 `requestUrl` 绕过重定向限制。关闭模态框不能撤回已经发送的请求；发生超时先检查 Studio。真实 Obsidian 桌面/移动端联调仍需人工检查，不从打包成功推断运行成功。

媒体上传的等待预算为10分钟，草稿等JSON写入仍为20秒；用户取消立即传递到进行中的上传。取消组合仅使用基本 AbortController，不要求 AbortSignal.any/timeout/throwIfAborted。原生宿主尚未验收，不据此承诺所有旧版 Electron/WebView 可运行。wiki 嵌入按字面文件名匹配（如 `100%.png`、`100%25.png` 是不同文件）；标准 Markdown URL 才解码一次（`100%25.png` 指向 `100%.png`）。链接包裹图片暂不导入，确认前明确报错，不上传、不保存破损结构。

参考官方 [插件示例](https://github.com/obsidianmd/obsidian-sample-plugin) 与 [API 声明](https://github.com/obsidianmd/obsidian-api)。
