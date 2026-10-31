# 图片衍生与安全缓存

封面位置比例、素材和展示设计见 [docs/COVERS.md](../../../docs/COVERS.md)；本文件只维护衍生处理与缓存实现，不据首页卡片位置强制裁切原图。

## 落库图（960 WebP）和展示图

上传只存一份缩小后的图，不保留大原图。`saveMedia` 是唯一入口，编辑器、媒体库上传、API/CLI/Markdown 导入、裁剪另存、AI 生成图都经过它：

- 静态 PNG、JPEG、静态 WebP：按 EXIF 方向转正，等比缩到最大 960 宽（从不放大），WebP q80（alpha 质量 100，透明保留）编码后写入 `media/<id>.webp`。D1 行的 `mime=image/webp`、`size` 为新字节数、`name` 改为 `.webp` 扩展名。常量 `IMAGE_STORE_RECIPE=s1`、`IMAGE_STORE_MAX_WIDTH=960`、`IMAGE_STORE_QUALITY=80` 只在 `src/modules/config/limits.ts` 维护。
- 宽度不进设置页：`960.webp` URL、srcset 宽度描述、`s1/` 衍生路径与存量迁移都依赖它；要改必须升级 `IMAGE_STORE_RECIPE` 并另写迁移。
- GIF、AVIF、动画 PNG/WebP、SVG（本来就不允许上传）、音视频、文档：原样保存在 `media/<id>`，不转码，避免丢帧或破坏矢量/媒体。浏览器预缩小同样识别动画 PNG（acTL）/动画 WebP（VP8X 动画位）并跳过，不会只留首帧；动画图超过 Worker 解码上限也照样原样保存（服务端先识别动画再检查尺寸）。
- 元数据：重新编码只写像素，EXIF/XMP/ICC 全部去除。ICC 只识别、不做色彩转换，输出按 sRGB 解释；广色域（Display P3/Adobe RGB）照片可能轻微偏色。浏览器导出的裁剪 JPEG 通常带 sRGB 配置，去掉不影响颜色。
- Worker 解码上限：16MiB / 400 万像素 / 单边 8192（实测 12MP JPEG 解码+缩放 RSS≈285MB，超过 128MB 限制）。超限上传返回 `413 IMAGE_TOO_LARGE`（提示先缩小再上传）。界面上传与裁剪另存先经 `upload-shrink.ts` 在浏览器按方向转正并缩到同时满足 960 宽、单边 8192、400 万像素的尺寸（无损 PNG 交给服务端），因此手机原图可以直接从 UI 上传；API/CLI 不做预缩小。
- 失败不静默、不退回保存大原图：尺寸头无效 `422 IMAGE_DIMENSIONS`、解码/编码失败 `422 IMAGE_CONVERT_FAILED`，经统一日志 `media.image_rejected`（warn）/`media.image_convert_failed`（error）记录；成功记 `media.image_stored_webp`（含前后字节数、尺寸、方向、是否有 ICC）。

`/api/files/:id`（含“下载原图”）现在返回的就是落库的 960 WebP。

展示端 `imageSources` 仍输出 480/960 两档 srcset，并附带 `data-fallback-src=/api/files/:id`：

- 落库图请求 `960.webp` 时直接返回 R2 中的落库对象（`X-Image-Processing: s1-stored`，ETag 为对象 SHA-256），不另存 960 衍生；`480.webp` 从落库图生成并存放在 `image-derivatives/v1/<id>/s1/`。
- 尚未迁移的旧原图（`media/<id>`、原 MIME）继续走旧路径 `image-derivatives/v1/<id>/` 生成 480+960，迁移前后 URL 不变。
- `Base.astro` 注册一次捕获阶段 `error` 监听：带 `data-fallback-src` 的图片加载失败时去掉 srcset，改用落库图，只回退一次并打印 `image.derivative_fallback`（内联脚本无法引入日志模块，格式与 `clientLog` 一致）。
- Photon 解码/Lanczos3 缩放、jSquash WebP 编码，WASM 在部署产物中预编译导入；上传落库、展示衍生与存量迁移脚本共用 `src/server/media/raster-codec.ts`，算法与参数一致。
- 封面原图/1:1/4:3/16:9、contain/cover、焦点和缩放继续由 `CoverFrame` 控制；落库图保持原始比例，1536×1024 落库为 960×640，480 档为 480×320。

## 对象和并发

衍生 manifest：`image-derivatives/v1/<原媒体ID>/manifest.json`。图片键包含原图 SHA-256、唯一生成批次及宽度；manifest 记录实际输出尺寸、字节数和输出 SHA-256。原媒体 ID 的内容不可变，更换封面生成新媒体 ID；调整编码器、质量或尺寸须升级配方版本，不覆盖已有缓存 URL 的含义。

manifest 最后提交，完成前不可被读取为成功。请求重复时复用 manifest；同实例的同图请求合并，所有原图读取/解码/编码串行，排队后再次确认是否已经完成。跨实例同时生成可能留下未胜出的完整批次，但不会删除另一实例的结果。部分写失败只清理本轮唯一批次；manifest 写响应丢失时返回明确失败、不删除可能已提交的结果，下次先回读核对。原图与 D1 都不参与衍生回滚。

## 公开与私有

- `/api/images/public/v1/:id/480.webp`（或 960）：不读取 Cookie/Bearer 身份。必须在当前未删除的 `public` 发布快照中找到原媒体的实际引用。作者不能用此路径读未发布图片；仅链接/密码文章也不满足公开条件。
- `/api/images/private/v1/:id/...`：复用原图鉴权；作者、密码授权、仅链接访问保持现有语义，响应始终 `private, no-store`。
- 每次网络请求先核验当前引用，再检查边缘缓存、ETag 或 HEAD；不能用 304 或已存字节绕过撤回检查。共享缓存只存身份无关的公开衍生字节，不存 HTML、原图或私有响应。
- 公开响应：`public, max-age=60, s-maxage=0, must-revalidate`。内部 Workers Cache 保存 600 秒，但只能在 Worker 完成上述授权后读取；`s-maxage=0` 避免 CDN 在 Worker 前直接复用。边缘缓存故障有日志并回源 R2。
- 撤回、删除或移除最后一个公开引用后，下一次网络请求立即拒绝；浏览器已经缓存的文件最多还可能新鲜 60 秒。已经下载或显示的图像无法远程收回。需要完全禁止浏览器保留时应采用零 TTL，而不能承诺“一年缓存并可立即撤回”。

## 降级与限制

衍生（480 档或旧原图）同样受 16MiB / 400 万像素 / 单边 8192 限制；超限或动画/GIF/AVIF 通过不可缓存重定向返回 `/api/files`，标记 `X-Image-Processing: original-unprocessed`。EXIF 方向现在在转码时被应用，不再因方向信息降级。尺寸头无效返回 422，解码/编码/存储失败返回 503 并记录日志；落库对象缺失记 `image.stored_object_missing` 并返回 503，前端回退到 `/api/files`。

迁移后内部边缘缓存最多 600 秒内仍可能返回旧衍生字节（同一张图、旧编码），不影响授权检查，过期后自然更新。

## 验证与生效

单测覆盖：落库 WebP 与 D1 字段、960 缩放、不放大、EXIF 方向 6/8 像素级核对、alpha、GIF 原样、413/422 与日志、WASM 失败后可继续、960 直接返回落库对象、480 存放于 `s1/`、旧原图路径。`npm run build && CHROMIUM_PATH=<Chromium> npm run test:e2e:images` 在一次性 Worker 验证上传即 960 WebP、`/api/files` 与 960 展示图逐字节一致、裁剪另存 960×540、响应式与权限。

存量原图由 `scripts/migrate-media-960.ts` 一次性转换（见 `scripts/README.md`），必须在新 Worker 部署之后运行；部署前旧代码不认识 `media/<id>.webp`。
