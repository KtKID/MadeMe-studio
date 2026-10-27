# 嵌入模块（embed）

第三方内容嵌入的**唯一规则来源**，以下四处都从这里取规则，不另写白名单：

- 编辑器：工具栏“嵌入”弹窗、BlockNote 媒体面板文案；
- 服务端内容校验：`src/server/content/validation.ts` 的 `validateContent` / `isSafeEmbed`；
- 阅读页渲染：`src/components/content/BlockReader.tsx` 的 `SafeEmbed`、视频块 `videoSource`；
- 按块定位的内容检查：`src/modules/content-check/`（编辑器保存前与服务端共用）；
- HTML 响应头：`src/server/response-policy.ts` 的 CSP `frame-src`。

解析只依赖 Web 标准 `URL`，Workers、浏览器和 Node 测试都能运行，不发网络请求。`autoHeight.ts` 是唯一的浏览器专用文件。

## 文件

| 文件                    | 职责                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `types.ts`              | `EmbedProvider` 等类型                                                                        |
| `registry.ts`           | 提供方注册表 `embedProviders`；通用检查与 `parseEmbed()`；`embedFrameOrigins()`；作者可读文案 |
| `providers/youtube.ts`  | YouTube（youtube-nocookie 播放器）                                                            |
| `providers/bilibili.ts` | Bilibili（player.bilibili.com 外链播放器）                                                    |
| `providers/x.ts`        | X / Twitter（platform.twitter.com 静态嵌入页 iframe，不加载 widgets.js）                      |
| `snippet.ts`            | `parseEmbedInput()`：从粘贴的官方嵌入代码里取出链接，再交给 `parseEmbed()`                    |
| `autoHeight.ts`         | `installEmbedAutoHeight()`：按 X 嵌入页的高度消息调整 iframe 高度，超时则降级为链接           |
| `providers/time.ts`     | 解析起始时间 `t`：`90` / `90s` / `1m30s` / `1h2m3s`                                           |
| `log.ts`                | `reportEmbedRejection()`：拒绝日志                                                            |
| `index.ts`              | 汇总导出                                                                                      |

## 一个提供方 = 一条配置

```ts
{
  id: "bilibili",                       // 稳定 id，写入日志与 data-embed
  name: "Bilibili",                     // 显示名
  hostnames: ["www.bilibili.com", …],   // 精确匹配，不做后缀匹配
  shortLinkHosts: ["b23.tv"],           // 短链：明确拒绝（reason=short_link_unsupported）
  kind: "iframe" | "link",              // 站内 iframe / 跳转卡片
  content: "video" | "post",            // 视频（可放进视频块）/ 动态帖子（只能用嵌入块）
  frameOrigins: ["https://player.bilibili.com"], // 汇总进 CSP frame-src
  frame: { title, allow, sandbox, referrerPolicy, aspectRatio | initialHeight },
  parse(url) → { id, handle?, part?, start? } | { reason },  // id 必须过正则
  playerUrl(target) → string,
  canonicalUrl?(target) → string,       // 规范链接：去掉追踪参数，用于保存与“在 X 查看”
}
```

新增平台的步骤：

1. 在 `providers/` 下新建一个文件；
2. 在 `registry.ts` 的 `embedProviders` 里登记；
3. 在 `tests/unit/embed-registry.test.ts` 补解析用例和恶意用例。

CSP、编辑器提示、服务端校验会自动跟着更新。

## 通用安全检查（`parseEmbed`，先于提供方执行）

- 必须是绝对 `https:` URL。不提供基址，所以协议相对的 `//host`、相对路径，以及 `javascript:`、`data:` 都会被拒绝。
- 不允许出现用户名或密码，不允许显式端口。
- 主机名与清单逐字相等，`bilibili.com.evil.com`、`evilbilibili.com` 都会被拒绝。
- 播放器地址由提供方用校验过的 id 重新拼出来，原链接里的查询串（如 `vd_source`、`spm_id_from`）不会带进 iframe。

## 支持的链接

| 平台     | 接受的形式                                                                                                                                                | 播放器                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| YouTube  | `youtube.com/watch?v=ID`、`m.youtube.com`、`youtu.be/ID`、`/shorts/ID`、`/embed/ID`、`/live/ID`、`youtube-nocookie.com/embed/ID`；`t` / `start` 参数      | `https://www.youtube-nocookie.com/embed/ID[?start=秒]`                                  |
| Bilibili | `www.bilibili.com` / `bilibili.com` / `m.bilibili.com` 下的 `/video/BV…` 或 `/video/av…`；`player.bilibili.com/player.html?bvid=…`；`p`（分P）、`t`（秒） | `https://player.bilibili.com/player.html?isOutside=true&bvid=…&p=N[&t=秒]&autoplay=0`   |
| X        | `x.com` / `twitter.com`（含 `www.`、`mobile.`）下的 `/用户名/status/数字`（可带 `/photo/N`），以及 `/i/web/status/数字`、`/i/status/数字`                 | `https://platform.twitter.com/embed/Tweet.html?id=数字&dnt=true`，下方附“在 X 查看”链接 |

- **id 规则**：BV 号为 `BV1` 加 9 位 base58 字符，av 号为纯数字，YouTube 为 11 位 `[\w-]`。分P 和时间无效时直接忽略，不会让整条链接被拒绝。
- **b23.tv 短链不支持**：要拿到 BV 号必须请求一次跳转，渲染和校验期间绝不发网络请求。作者会看到提示：在浏览器打开短链后复制完整地址。
- **iframe 属性**：
  - 两个播放器都设置 `sandbox`，都不给 `allow-top-navigation`，无法劫持文章页；
  - Bilibili 额外允许新窗口打开 B 站页面；
  - `referrerpolicy` 为 `strict-origin-when-cross-origin`，YouTube 缺少来源信息时会报 153 错误。

## 粘贴官方嵌入代码（`snippet.ts`）

作者常直接复制平台的“嵌入”代码（X 的 `<blockquote class="twitter-tweet">… <script src="https://platform.x.com/widgets.js">`、YouTube / Bilibili 的 `<iframe>`）。

- 以 `<` 开头的输入视为嵌入代码，只用正则取出 `href` / `src` 属性值，做最少的实体解码（`&amp;` 等），`//host` 补成 `https:`；
- 依次交给 `parseEmbed()`，第一个通过的链接胜出，结果带 `fromSnippet: true` 和规范链接 `match.canonicalUrl`；
- **从不渲染、保存或执行粘贴的 HTML**：`<script>`、`widgets.js`、`javascript:` 链接、仿冒域名都不会通过；
- 超过 20000 字符返回 `too_long`；没有可识别链接返回 `snippet_without_link`。

编辑器“嵌入”弹窗和视频块提示都用它；服务端仍然只接受链接，嵌入代码原样提交会得到 422 和按块定位的中文原因。

## X 动态的 iframe（2026-10-27 起）

- 用 X 官方的静态嵌入页 `platform.twitter.com/embed/Tweet.html?id=…&dnt=true`，**不加载 `widgets.js`，CSP 不加 script-src**，`frame-src` 由注册表自动加上 `https://platform.twitter.com`；
- `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`，没有 `allow-top-navigation`；
- 嵌入页通过 `postMessage` 发 `twttr.private.resize` 告知高度。`autoHeight.ts` 只接受来自登记来源、且 `event.source` 正是该 iframe 的消息，高度限制在 80–4000px；
- 初始高度默认 360px、等待默认 12 秒（设置页“嵌入与阅读”可调）；等待时间内没有收到高度消息（动态已删除、被墙、X 改版）就隐藏 iframe，只显示“在 X 查看 @用户 的动态”链接，并记 `embed.frame_unavailable`（只含 provider）；
- 链接始终显示在 iframe 下方，作为降级与原文入口。

验证证据见 `reports/2026-10-27-x-embed-silent-publish.md`。

## 视频块与嵌入块

- **视频块**（BlockNote 自带）有两种来源：“从电脑上传”和“粘贴链接”。
  - 站内文件和 `.mp4` / `.webm` 等直链用 `<video>` 播放；
  - 匹配 iframe 类提供方的链接用对应播放器；
  - 其他网页渲染跳转卡片。
  - 视频块里粘贴了 YouTube / Bilibili 嵌入代码：编辑器自动换成规范链接；
  - 视频块里是 X 动态（链接或嵌入代码）：编辑器提示“改为嵌入块”，一键替换。
- **嵌入块**（工具栏“嵌入”按钮）：只接受注册表里的链接，服务端用同一个 `parseEmbed` 校验后才保存。

已知限制：编辑器里视频块的预览仍是 BlockNote 自带的 `<video>`，平台链接要在阅读页或预览页才显示播放器。想在编辑器里直接看到播放器，可以改用“嵌入”按钮。

## 日志

`reportEmbedRejection(where, result)` 记录一条 `embed.rejected` info 日志，只包含 `where`、`reason` 和 `host`，**不记录完整 URL 和查询串**。

- 浏览器端走 `clientLog`，服务端走 `logger`；
- 编辑器弹窗的实时预览用 `silent`，不会每按一次键记一条；
- 成功的解析不记录。

## 以后改为可配置

提供方清单目前写在代码里（`registry.ts` 的 `embedProviders`）。以后要在设置里开关平台时，只让这个数组按设置过滤即可。每个提供方的解析和正则仍必须留在代码里，不能从配置注入正则或播放器模板。CSP 由 `embedFrameOrigins()` 生成，会跟着变化。
