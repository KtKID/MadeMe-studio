# 内容与阅读模块

- `Dashboard.tsx`：搜索、分类、置顶、软删除与恢复；空库不生成假文章。
- `PublicFeed.tsx`：公开文章卡片、分类和搜索。
- `BlockReader.tsx`：将规范 BlockNote JSON 转成转义后的 React/SSR HTML；没有 raw HTML 注入。

## 安全约束

数据可见性由服务器决定，前端过滤不是权限边界。YouTube 使用固定隐私增强域名。X 使用经白名单验证的外链卡片，不执行第三方脚本。受保护文章在验证前不显示正文。

## 测试

`tests/ui-render.test.tsx` 覆盖文本转义、危险链接、白名单嵌入与真实空状态；`tests/e2e/author-flow.spec.ts` 覆盖列表与回收站实际操作。

首页路由使用 `loadPublicPageData`，即使作者已登录也只展示公开发布快照，不显示更新中的标题、摘要或封面。四种首页结构由 `data-layout` 控制，不改变配色或明暗。旧表格缺少 cells 时跳过异常行，保证其他正文仍可读。

连续同级编号/项目列表在 SSR 中分组，编号使用浏览器原生顺序，显式 start 通过起点或 li value 保留；嵌套层级独立分组。表格保留受限的正整数 colspan/rowspan、thead/th 与表头范围。`tests/reader-structure.test.tsx` 覆盖这些富文本保真语义。

## 文章工作台摘要

Dashboard 使用由 `postSchema.pick` 派生的 `PostSummary`，正文仅在编辑/阅读按需查询。置顶、删除、恢复返回完整文章后也通过同一 schema 投影，避免意外将正文留在列表状态。日期格式器模块内复用并固定上海时区。没有增加共享私有 HTML 缓存，也未改变设置/编辑页的完整导航与未保存保护。

## 按钮并发保护

文章置顶、回收与恢复以文章 ID 建立同步请求锁；同帧重复点击不重复提交，不同行请求的完成不会清除其他行的忙碌状态。失败后仅释放对应行，允许显式重试。初始列表错误由 Dashboard 自身显示，不伪装成正常空列表。

## 视频块渲染

BlockNote 视频块的“嵌入”页签接受任意链接，`BlockReader` 通过 `videoSource()` 分流：站内 `/api/files/...`（不看扩展名，.mov 按 `video/quicktime` 返回）与 `.mp4/.webm/.mov/.ogv` 等直链用不带 `type` 的 `<video src>`；匹配 `src/modules/embed` 注册表中 iframe 提供方（YouTube、Bilibili）的链接改用 `SafeEmbed` 播放器；其他网页降级为“在 <域名> 观看视频”跳转卡片。空 url（上传未完成留下的块）不渲染。`safeUrl()` 对空串、纯空白和非 `/` 开头的相对路径返回 `undefined`，不再生成 `https://local.invalid/` 占位地址。嵌入规则（提供方、id 校验、iframe 属性）全部来自 [src/modules/embed](../../modules/embed/README.md)，见 `tests/embed-rendering.test.tsx`。测试见 `tests/video-rendering.test.tsx`。
