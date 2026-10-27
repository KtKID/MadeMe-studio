# 2026-10-27：文章视频块显示 0:00 无法播放

## 现象

线上文章《部署到cf的第一篇文章》（slug `cf-46630d`）里有两个视频块，都显示成 0:00 的播放器，点了也放不了：一个用“嵌入”插入，一个是上传的。

## 证据（只读排查）

- 生产 D1 的 `posts` 表、两条 `revisions`（v1 save、v2 publish，2026-10-27 17:52 UTC+8）记录的正文一致：
  1. `type:"video"`，url 是 Bilibili **播放网页** `https://www.bilibili.com/video/BV1KW4y1j7AF/?…`（BlockNote 自带视频块的“嵌入/链接”页签）。
  2. `type:"video"`，url 为 `""`，name 为 `""`。
- `media` 表只有一张 image.png（17:50 UTC+8），**没有任何视频记录**，也就是视频从来没有存进 R2/D1。
- 修复前的线上 HTML：
  - `<video src="https://www.bilibili.com/video/…">`：网页（text/html）不是媒体文件，`<video>` 永远放不了。
  - `<video src="https://local.invalid/">`：`safeUrl("")` 被解析成占位基址。
- 文章页 CSP 只有 `object-src 'none'; base-uri 'self'; form-action 'self'`，不限制 media/frame，可以排除 CSP 的原因。
- 历史 Workers Logs 查不到：当前 API 令牌没有 Observability 权限（403），无法拿到当时上传请求的具体失败码。

## 根因

| 视频             | 结论                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 嵌入（Bilibili） | 输入不受支持，加上渲染缺陷。站内的“嵌入”功能（工具栏 → 嵌入）只支持 YouTube/X；BlockNote 视频块的链接页签却什么链接都收，阅读页又把它直接交给 `<video>`。Bilibili 站内播放属于**未实现的功能**。                                                                                      |
| 上传             | 上传失败，加上失败静默（bug）。上传被拒或出错时，BlockNote 只显示通用“上传失败”，块以空 url 留下；阅读页又因 `safeUrl("")` 返回 `https://local.invalid/` 渲染出假播放器。具体拒绝原因没有日志证据，最可能是超过 25 MB，或是格式不支持（如 .mov `video/quicktime`，只支持 MP4/WebM）。 |

## 修复（版本 1b0c2460-324d-43bd-af81-55068f5828e2）

- `safeUrl()`：空串、纯空白、非 `/` 开头的相对路径一律返回 `undefined`，空视频块不再渲染。
- `BlockReader` 新增 `videoSource()`：
  - 站内 `/api/files/…` 和直链视频文件用 `<video>`；
  - YouTube 页面改用 youtube-nocookie iframe；
  - 其他网页（含 Bilibili）降级为“在 <域名> 观看视频”跳转卡片。
- 编辑器 `uploadFile`：
  - 上传前用共享的 `mediaUploadProblem()` 检查大小（`MAX_MEDIA_BYTES`，与服务端同一常量）和 MIME；
  - 拒绝时写 `editor.upload_rejected` 日志（只有 reason/mime/size，不记文件名），并在提示栏显示中文原因；
  - 服务端拒绝时显示“上传失败：<原因>”，`api()` 照常记录 `api.request_failed`。
- 没有改动用户文章数据。

## 验证

- `tests/video-rendering.test.tsx`（10 项）用生产数据形态复现并验证。
- 全量 `npm test` 61 文件 / 443 项通过；`npm run check` 0 错误；build、smoke、worker 端到端全部通过。
- 线上 `/p/cf-46630d`：Bilibili 块变成跳转卡片，空块不再渲染，页面里已没有 `local.invalid`，图片 200 image/png。

## 待作者决定

- 是否支持 Bilibili 站内播放：用 `player.bilibili.com/player.html?bvid=…` 的 iframe 加入嵌入白名单，前后端校验都要改。
- 是否在编辑器里拦截视频块填网页链接（引导改用“嵌入”）。
- 是否支持 .mov：需要转码或接受 `video/quicktime`，但浏览器兼容性有限。
- 那个空视频块需要作者在编辑器里删掉，然后用 ≤25 MB 的 MP4/WebM 重新上传。

## 避免再踩坑

- 第三方组件吞掉的异常，必须在我们自己的回调里记日志并展示。
- URL 白名单函数要对空值返回“无”，不能借占位基址补全。
- 生产排障需要 Workers Logs 时，令牌要另加 Observability 读权限。
