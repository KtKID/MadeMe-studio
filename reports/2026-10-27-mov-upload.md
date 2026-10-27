# 2026-10-27：支持直接上传 .mov（QuickTime）视频

## 背景

作者的测试文件是 macOS 录屏 .mov：402 KB，H.264，352×364，4 秒，多半没有音轨。之前的 MIME 清单只有 MP4 和 WebM，上传前检查会直接拒绝它。作者决定：**直接接收 .mov，不要求转码**。

## 改动

- `src/shared/contracts.ts`：
  - `acceptedMediaMimeTypes` 增加 `video/quicktime`；
  - 新增 `acceptedVideoFormatsLabel = "MP4、WebM、MOV"`，作为文案的唯一来源；
  - `mediaUploadProblem` 的拒绝文案改用这个常量；
  - 25 MB 上限不变。
- `src/server/media/service.ts`：新增 `isQuickTime()` 签名校验。
  - `ftyp` 开头，或没有 ftyp、以 `moov` / `wide` / `mdat` / `free` / `skip` / `pnot` 开头的旧式文件都接受；
  - 原子长度必须合法；
  - 伪装成 .mov 的文件返回 415 `MEDIA_SIGNATURE_MISMATCH`。
- 编辑器的媒体面板和拒绝提示都显示“MP4、WebM、MOV”。
- 阅读页不用改：站内媒体本来就渲染为不带 `type` 的 `<video src>`，不依赖扩展名。

## 播放方案的选择（实测）

用 ffmpeg 生成 H.264 无音轨的 .mov（`-f mov`，ftyp 为 `qt  `，moov 分别放在文件尾和文件头），在 Chrome 无头浏览器里试了各种组合：

| 组合                                                  | 结果                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| `<video src>`，响应头 `video/quicktime`，带 nosniff   | 能播放（4 秒，352 宽）                     |
| `<video src>`，响应头 `video/mp4`                     | 能播放                                     |
| moov 在文件头，`video/quicktime`                      | 能播放                                     |
| `<source type="video/quicktime">`                     | **被跳过**：Chrome 的 `canPlayType` 返回空 |
| `<source type="video/mp4">`，响应头 `video/quicktime` | 能播放                                     |

结论是**保留真实的 `video/quicktime`，阅读页不写 type**：

- Chrome 已实测能播放；
- Safari 原生支持 QuickTime；
- 不需要解析编码再把响应头改成 mp4。

能否播放取决于编码：H.264 可以；HEVC 和 ProRes 在 Chrome、Firefox 上可能不行，要先转成 H.264。Firefox 未实测。

## 验证

- **单元测试**：新增 `tests/unit/media-quicktime.test.ts`。
  - 用 ffmpeg 生成的 fixture `tests/fixtures/screen-recording.mov`（1 秒，10 KB）验证签名；
  - 覆盖无 ftyp 的旧式原子、伪装 PNG、畸形长度、25 MB 上限、清单与文案、渲染不带 type。
- **Worker 端到端**：`tests/worker/flow.mjs` 增加 .mov 上传。
  - 返回 201，mime 为 `video/quicktime`，响应头为 inline 和 nosniff；
  - `Range: bytes=0-` 返回 206；
  - 伪装的 .mov 返回 415。
- **全量**：`npm test` 64 个文件 / 487 项通过；`npm run check` 0 错误；build、smoke、worker 都通过（使用仓库内配置）。
- **本地 workerd 加 Chrome**：上传一个 4 秒、352×364、H.264 的 .mov，并把它插进一篇已发布文章。
  - 作者实例和访客实例打开 `/p/…` 都能播放；
  - 拖动到 3 秒正常；
  - 媒体请求为 `206 video/quicktime`，`<video>` 不带 type。
- **生产**：只检查了响应头和上限。没有会话，无法通过真实 API 上传。

## 作者需要做的

1. 在编辑器里删掉文章 cf-46630d 里那个空的视频块。
2. 插入视频块，选择“从电脑上传”，选中那个 .mov 文件。
3. 保存并发布。

如果上传失败，编辑器顶部会显示具体原因，比如超过 25 MB 或格式不支持。

## 避免再踩坑

- 不要给 `<video>` 或 `<source>` 写 `type="video/quicktime"`，否则 Chrome 会跳过这个视频。
- 新增格式要同时改 `acceptedMediaMimeTypes`、`validateMedia` 的签名分支和 `acceptedVideoFormatsLabel`。三者都在 shared/contracts 和 media/service 里，下一步会改为可配置。
