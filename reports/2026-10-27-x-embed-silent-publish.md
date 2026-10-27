# 2026-10-27：视频块粘贴 X 嵌入代码后发布“没反应”

## 现象

作者在文章 `cf-46630d` 的**视频块**“粘贴链接”里粘贴了 X 官方嵌入代码（`<blockquote class="twitter-tweet">…</blockquote> <script async src="https://platform.x.com/widgets.js">`），点“发布 → 确认发布”后弹窗不关、也没有任何提示，约 19:00（UTC+8）。

## 证据

- **生产 D1（只读）**：`cf-46630d` 为 v6，最后更新 2026-10-27 19:03（UTC+8）；草稿与已发布快照一致（Bilibili 视频、站内上传视频、图片），**没有任何嵌入代码被保存**，说明那次保存被服务端拒绝。未修改该文章任何数据。
- **生产日志**：`wrangler tail` 只能看实时流，Workers Logs 历史查询 API 对当前令牌返回 403，因此 19:00 那次的 `request.rejected` 事件无法回溯（未打印任何敏感值）。
- **本地复现（workerd + 无头 Chrome）**：同样操作，`PATCH /api/posts/:id` 返回 **422 `UNSAFE_URL`**，消息为英文“Content links must use HTTPS, email, or uploaded media.”。

## 根因

1. 服务端拒绝是正确的（视频地址是一段 HTML，不是链接）。
2. 编辑器把错误写进页面顶部提示栏，但**发布弹窗仍打开并带模糊遮罩**，提示被遮住，弹窗里没有任何错误——对作者来说就是“静默失败”。
3. 即使看到，也是英文、不指出哪一块；BlockNote 视频块里只显示一个坏掉的播放器。
4. 审计发现同类问题：AI 弹窗、历史版本/恢复弹窗的失败同样只在被遮住的顶部显示；未登录时 `save()` 直接 `return`，没有任何提示。
5. 另外，任何 409（包括“链接标识冲突”“文章已删除”）都会显示“载入最新版本”，原因不准确。

## 修复

### 失败一律可见、中文、带位置、写日志

- 新模块 `src/modules/content-check/`：按块扫描链接与嵌入，生成“第 N 个视频块的地址不是视频文件或支持的平台链接……”等中文原因。**编辑器保存前预检**（不发请求、高亮并滚动到该块、记 `editor.save_blocked`）与**服务端 `validateContent`** 共用同一规则；服务端 422 的 `message` 即中文原因，`details.problems` 带 `blockId/blockType/ordinal`，并记 `content.rejected`（只有 reason/blockType/ordinal/field，不含 URL）。
- `src/components/editor/errors.ts`：`describeEditorError()` 把所有失败转为“保存失败：/发布失败：……”，英文错误码逐个翻译；编辑器所有 catch（保存、发布、撤下、载入最新、导入、AI、历史、恢复）统一走 `fail()`，非 API 异常记 `clientCaught`。
- 错误同时显示在顶部（自动滚动可见）**和当前弹窗内**（发布 / AI / 历史版本）。
- 未登录保存给出提示并记日志；只有版本冲突才显示“载入最新版本”。
- `ApiError` 增加 `details`，供编辑器定位块。

### 嵌入代码解析（从不渲染粘贴的 HTML）

- `src/modules/embed/snippet.ts` 的 `parseEmbedInput()`：只用正则取 `href`/`src` 属性值，最少实体解码，交给原有 `parseEmbed()`；`<script>`、`widgets.js`、`javascript:`、仿冒域名一律不通过；超长（>20000）与无链接分别给出原因。
- 支持：X/Twitter blockquote、YouTube iframe、Bilibili iframe（含 `//player.bilibili.com` 与 `&amp;`）→ 规范链接。
- X 链接接受 `x.com` / `twitter.com`（含 `www.`、`mobile.`）的 `/用户名/status/ID`（可带 `/photo/N`）以及 `/i/web/status/ID`；保存时去掉 `?ref_src=` 等追踪参数。
- 视频块：YouTube/Bilibili 嵌入代码自动换成规范链接；X 动态（链接或代码）显示提示条与一键“**改为嵌入块**”；认不出的代码提示“移除这个视频块”。
- 工具栏“嵌入”弹窗改为多行输入，直接接受官方嵌入代码，显示“已从嵌入代码中识别出 … 链接”。

### X 动态渲染：决定改为 iframe

评估 `https://platform.twitter.com/embed/Tweet.html?id=<id>`（无头 Chrome，本站同等 CSP `frame-src … https://platform.twitter.com`，不加 script-src）：

| 检查                           | 结果                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 响应                           | 200，无 `X-Frame-Options` / `frame-ancestors`，可被嵌入                                                                               |
| 用户的动态 2115000078104691168 | 文字与图片完整渲染；带 `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"` 同样正常；控制台无错误 |
| 高度                           | 嵌入页 `postMessage` `twttr.private.resize`，该动态 783px，id=20 为 225px                                                             |
| 不存在的 id                    | 404、空白、无高度消息 → 需要降级                                                                                                      |

结论：**可靠，X 改为 iframe 提供方**，`content: "post"`（只能用嵌入块）。

- 不加载 `widgets.js`，CSP 不加 script-src；`frame-src` 由注册表自动加入 `https://platform.twitter.com`；无 `allow-top-navigation`。
- 阅读页加第一方脚本 `installEmbedAutoHeight()`：只接受来自登记来源、且 `event.source` 正是该 iframe 的高度消息，限制 80–4000px；12 秒无消息则隐藏 iframe、仅显示链接卡片并记 `embed.frame_unavailable`。
- iframe 下方始终显示“在 X 查看 @用户 的动态 ↗”（规范链接）。

## 验证

- `npm test`：68 个文件 / 516 个用例通过。新增 `tests/unit/embed-snippet.test.ts`、`tests/unit/content-check.test.ts`、`tests/unit/editor-errors.test.ts`、`tests/ui/editor-save-errors.test.tsx`，更新 `embed-registry` / `embed-rendering` 的 X 断言。
- `npm run check`：0 错误（4 条既有 hint）；`npm run build`、`npm run test:smoke` 通过。
- `npm run test:worker`：新增真实 Worker 断言——嵌入代码 PATCH 得到 422 `UNSAFE_URL`、中文“第 1 个视频块……X 的嵌入代码”、`details.problems` 定位；改为嵌入块后可发布，阅读页 CSP 含 `platform.twitter.com`、HTML 含 Tweet.html iframe 与“在 X 查看 @op7418 的动态”，无 widgets.js。
- 本地 workerd + 无头 Chrome 全流程：真实 BlockNote 视频块粘贴嵌入代码 → 出现提示条；发布 → **弹窗内**显示“发布失败：第 1 个视频块里粘贴的是 X 的嵌入代码……”，且没有发出任何保存请求；点弹窗内“改为嵌入块” → 确认发布成功（PATCH + publish）；阅读页 iframe 自动调整为 783px，状态 ready。“嵌入”弹窗粘贴同一段代码 → 识别、预览并插入规范链接。
- 部署：版本 `9f04a277-07d5-4044-9524-e353259db149`；线上检查见文末。

## 作者需要做什么

`cf-46630d` 里没有保存任何嵌入代码，数据无需修复。打开编辑器后任选其一：

1. 点工具栏“嵌入”，直接粘贴 X 的嵌入代码或动态链接 → 插入内容；
2. 或者照旧粘进视频块，点提示条里的“改为嵌入块”。

然后发布即可。

## 避免再踩坑

- 新增保存/发布类操作必须用 `fail(action, e)`，并确认错误在当前打开的弹窗里可见；有弹窗的地方都放 `modalError`。
- 新增内容规则写进 `src/modules/content-check`，编辑器与服务端自动一致；不要在 `validation.ts` 另写只有英文的检查。
- 新增嵌入平台：在 `src/modules/embed/providers/` 登记，并补嵌入代码解析用例（`tests/unit/embed-snippet.test.ts`）。
- 日志只记 reason/host/blockType/ordinal，不记 URL 或粘贴的代码。

## 线上检查（版本 9f04a277，2026-10-27 19:29 UTC+8）

- `/`、`/p/cf-46630d`、`/login` 均 200；未登录 `POST /api/media` 返回 401。
- 阅读页 CSP：`frame-src 'self' https://platform.twitter.com https://player.bilibili.com https://www.youtube-nocookie.com`，无 script-src 变化。
- 线上编辑器脚本包含“改为嵌入块”等新文案。
- 在线上阅读页（生产 CSP 下）临时插入 Tweet.html iframe（只在无头浏览器内存中，不改任何数据）：自动高度脚本把高度调整为 780px，状态 ready，无 CSP 报错。
- 首次 `wrangler deploy` 遇到 Cloudflare 未知错误 10013，10 秒后原样重试成功。
