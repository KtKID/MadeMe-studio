# 媒体模块

媒体二进制存入 R2，文件元数据写入 D1；数据库失败时清理刚写入的对象，避免孤立上传。上传上限按类型来自设置页“上传与媒体”（默认 25 MB，硬上限 50 MB，见 `src/modules/config`），校验允许 MIME 与主要文件签名，不接受 HTML 或 SVG。

新增的[图片衍生与安全缓存](../../modules/image-delivery/README.md)保留这条原图链路，按需生成 480/960 WebP；公开/私有路径分别授权，只有确实被公开快照引用的衍生图允许短时浏览器缓存。下文的 `private, no-store` 继续适用于原图与音视频，不应整体把媒体桶或 `/api/files` 改为公开缓存。

文件 URL 只暴露不可预测媒体 ID。每次读取均检查作者身份，或检查未删除已发布文章中的引用和该文章的访问权限。未发布媒体、没有有效密码授权的文件不能直接访问。

图片/音视频使用正确 MIME；其他文件强制附件下载。响应使用 `nosniff`、隔离 CSP、同源资源策略及 `private, no-store`，避免共享缓存泄露密码媒体。下载可通过 `?download=1` 请求。

媒体历史返回最近 N 条（设置页“媒体库展示条数”，默认 100），支持文件名/生成提示词搜索和来源筛选。上传并不自动发布或自动关联文章正文；作者仍需插入块或设置封面。

验证包括签名拒绝单元测试和真实 HTTP 上传→私有读取拒绝→发布引用→删除后拒绝的端到端测试。测试中的 R2 适配器模拟对象存储，真实 Cloudflare R2 联调需另行运行。

## 音视频范围读取

授权成功后支持单个 `Range: bytes=start-end`、`bytes=start-`、`bytes=-suffix`，直接使用 R2 的范围流，不下载整个对象再切片。授权检查先于 R2 `head/get`，未授权者仍返回 404，不能通过 416 推断私有文件长度。

- 有效范围返回 206，携带 `Content-Range`、`Content-Length`、`Accept-Ranges: bytes`；越过末尾的结束位置自动截断。
- 合法但不可满足的范围（包括零长度后缀）返回空正文 416 和 `Content-Range: bytes */实际长度`。
- 非法范围、超过 1024 字符的范围、多个范围和未知范围单位明确忽略，返回完整 200；不实现 multipart/byteranges。未提供可比较验证器，携带 `If-Range` 时也回退完整 200，避免拼接不确定版本。
- 使用 R2 实际长度，不信任 D1 历史大小；若 head/get 之间大小变化，取消流并返回 503，避免错误的部分响应。
- 完整与部分响应均维持 `private, no-store` 和原有安全头；此功能不引入缓存。

协议依据：[RFC 9110 §14](https://www.rfc-editor.org/rfc/rfc9110.html#section-14)、[Cloudflare R2 Workers 范围读取](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#ranged-reads)。`tests/backend/media-range.test.ts` 使用生成的非用户音频头字节，覆盖范围字节、权限顺序、真实长度、并发大小变化与回退语义。

`HEAD /api/files/:id` 与 GET 使用相同权限判断，只读取 R2 元数据，忽略 Range 并返回完整长度、无正文。

## 上限常量

`MAX_BYTES` 取自 `src/shared/contracts.ts` 的 `MAX_MEDIA_BYTES`，编辑器上传前检查（`mediaUploadProblem`）与服务端 `validateMedia` 共用同一上限与 MIME 清单，修改时只改一处。

## QuickTime（.mov）

- **接受的内容**：`video/quicktime`，即 macOS 录屏和 iPhone 视频，上限同视频类型的配置（默认 25 MB）。
- **签名校验**：`isQuickTime()`。
  - 首个原子为 `ftyp`（品牌通常是 `qt  `）即通过；
  - 没有 ftyp 的旧式文件，首个原子为 `moov` / `wide` / `mdat` / `free` / `skip` / `pnot` 之一也通过；
  - 原子长度必须合法：`mdat` 可以为 0，任意原子可以为 1（64 位扩展长度），其余须在 8 到文件长度之间。
  - 声明为 .mov、内容却是别的文件，返回 415 `MEDIA_SIGNATURE_MISMATCH`。
- **返回方式**：按原 MIME `video/quicktime` 存储和返回，不改写成 `video/mp4`。范围读取（206 / 416）与 MP4 相同。阅读页用不带 `type` 的 `<video src>`。

为什么这样做（2026-10-27 用 Chrome 无头浏览器实测）：

- `Content-Type: video/quicktime` 加 `nosniff` 时，Chrome 能正常播放和拖动 H.264 的 .mov，moov 原子在文件头或文件尾都可以。
- Chrome 的 `canPlayType("video/quicktime")` 返回空串，所以写 `<source type="video/quicktime">` 会被 Chrome 直接跳过。正确做法是不写 type。
- Safari 原生支持 QuickTime。
- 保留真实的 MIME，不需要为了兼容去解析编码再改写响应头。

能否播放取决于**编码**，与容器无关：

- H.264 在各浏览器都能播放；
- HEVC（iPhone 默认的“高效”格式）和 ProRes 在 Chrome、Firefox 上可能无法播放，需要先转成 H.264；
- Firefox 尚未实测。

MIME 清单在 `src/modules/config/limits.ts`（`MEDIA_TYPES`），各类型上限与禁用类型在设置页配置；前后端共用 `uploadProblem()`，格式文案由 `formatsLabel()` / `uploadHint()` 生成。AI 生成的图片不受作者上传配置影响，使用硬上限策略 `GENERATED_MEDIA_POLICY`。
