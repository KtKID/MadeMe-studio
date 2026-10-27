# 2026-10-27：嵌入模块化与 Bilibili 播放器

## 背景

上一份报告（[视频块 0:00](2026-10-27-video-blocks.md)）的待决定项里，作者确认了嵌入模块的设计。这次要做的是：

- 嵌入规则独立成模块，编辑器、服务端校验、阅读页渲染和 CSP 共用同一份配置；
- 迁移 YouTube 和 X 的现有逻辑；
- 新增 Bilibili；
- 文章 `cf-46630d` 视频块里的 Bilibili 链接不改数据就能直接播放。

## 实现

- 新模块 `src/modules/embed/`，说明见其 README：
  - `types.ts`、`registry.ts`、`log.ts`、`index.ts`；
  - `providers/youtube.ts`、`bilibili.ts`、`x.ts`、`time.ts`。
- 每个提供方是一条配置：id、显示名、主机名（精确匹配）、短链主机、类型（iframe 或 link）、frame 来源、iframe 属性（allow、sandbox、referrerpolicy、宽高比），以及 `parse`（id 正则校验、分P 和起始时间）和 `playerUrl`。
- 通用检查 `parseEmbed()`：
  - 只接受绝对 https 地址，所以 `javascript:`、`data:`、协议相对 `//`、相对路径都被拒绝；
  - 不允许用户名密码，不允许端口；
  - 主机名必须逐字相等，`bilibili.com.evil.com` 会被拒绝；
  - 播放器地址只用校验过的 id 重新拼出来，原链接里的追踪参数不会带进去。
- 接入点：
  - `BlockReader` 的 `SafeEmbed`、`videoSource` 和 `embedUrl`（保留为兼容包装）；
  - `validation.ts` 的 `validateContent` 和 `isSafeEmbed`：改为严格解析，非法 id 也返回 422；
  - `response-policy.ts`：新增 `frame-src 'self' https://player.bilibili.com https://www.youtube-nocookie.com`，由注册表生成；
  - 编辑器：嵌入弹窗的支持清单、实时拒绝提示和规范化插入都来自模块；BlockNote 媒体面板改为“从电脑上传 / 粘贴链接”。
- 日志：拒绝时记录 `embed.rejected`，info 级别，只含 `where`、`reason`、`host`，不记完整 URL 和查询串。编辑器的实时预览不写日志。
- Bilibili 支持的链接：
  - `www.bilibili.com`、`bilibili.com`、`m.bilibili.com` 下的 `/video/BV…` 和 `/video/av…`；
  - `player.bilibili.com/player.html?bvid=…`（或 `aid=…`）；
  - 参数 `p`（分P）、`t`（秒）；
  - 播放器地址为 `https://player.bilibili.com/player.html?isOutside=true&bvid=…&p=N[&t=秒]&autoplay=0`。
  - `b23.tv` 短链明确拒绝（`short_link_unsupported`），并提示作者粘贴完整地址。渲染期间不跟随跳转。

## 验证

- **测试**：
  - 新增 `tests/unit/embed-registry.test.ts`：各提供方解析、恶意 URL、起始时间、服务端拒绝日志、CSP；
  - 新增 `tests/embed-rendering.test.tsx`：用户文章渲染为 Bilibili iframe，YouTube 和 X 行为不变；
  - 更新 `tests/backend/posts.test.ts`：YouTube 的非法 id 现在会被拒绝；
  - 更新 `tests/video-rendering.test.tsx`：跳转卡片改用未登记平台作为示例。
- **全量**：`npm test` 63 个文件 / 481 项通过；`npm run check` 0 错误；build、smoke、worker 端到端都通过（使用仓库内配置，之后已恢复生产配置）。
- **上线前检查**：生产 D1 里没有任何 embed 块，严格校验不会影响已有文章。`player.bilibili.com` 的响应头没有 X-Frame-Options 或 frame-ancestors，可以被嵌入。
- **线上**（版本 c140ffed-8a19-466b-b9bf-bbbe750aa06a）：
  - `/p/cf-46630d` 输出 `<iframe src="https://player.bilibili.com/player.html?isOutside=true&bvid=BV1KW4y1j7AF&p=1&autoplay=0">`，带 sandbox，没有 allow-top-navigation；
  - CSP 头含上述 frame-src，`/`、`/login`、`/studio` 原有的指令都还在；
  - 用 Chrome 无头浏览器打开：iframe 加载了“哔哩哔哩嵌入式外链播放器”并开始播放，控制台没有 CSP 违规。
  - 文章数据没有改动。

## 已知限制

- Bilibili 外链播放器目前会**无视 `autoplay=0`，静音自动播放**。实测 `autoplay=0`、`autoplay=false`、`poster=1` 都一样。iframe 已设 `loading="lazy"`，滚动到可见位置才加载。如需彻底不自动播放，可以改成“点击封面后才加载 iframe”，这需要额外设计。
- 编辑器里视频块的预览仍是 BlockNote 自带的 `<video>`，平台链接要在阅读页或预览页才显示播放器。
- 提供方清单目前写在代码里。以后要改为可配置，见模块 README 的“以后改为可配置”一节。

## 避免再踩坑

- 新增平台只改 `src/modules/embed/`，不要在组件或服务端里另写主机白名单。
- 主机名必须精确匹配，id 必须过正则，播放器地址只用 id 重新拼出来。
- 新增 iframe 平台时，CSP frame-src 会自动更新；在 `embed-registry.test.ts` 补上对应用例。
