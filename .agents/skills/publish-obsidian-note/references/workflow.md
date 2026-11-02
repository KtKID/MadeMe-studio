# 参数执行与现有接口

## 复用入口

从仓库根目录运行，使用 Node 24 和已安装依赖。先核对以下单一来源，接口不一致时停止：

- [共享客户端](../../../../integrations/shared/client.ts)：`normalizeSiteUrl`、`normalizeMarkdown`、`titleFromMarkdown`、`uploadAttachment`、`createDraftWithAttachments`、`publishPost`。
- [附件模块](../../../../src/modules/markdown-import/attachments.ts)：`attachmentPlan`、`attachmentFile`、`prepareAttachments`；正文转换和 MIME 类型映射已由共享客户端复用。
- [请求／响应 Zod](../../../../src/shared/contracts.ts)：`createPostSchema`、`patchPostSchema`、`postMutationResponseSchema`、`mediaResponseSchema`、`POST_SCHEMA_ACCEPT`。不要另写协议类型或手拼 BlockNote。
- [封面协议](../../../../src/modules/cover/contracts.ts)、[分类协议](../../../../src/modules/article-types/contracts.ts)、[真实路由](../../../../src/server/api.ts)。

这些是源码模块，不是独立 CLI。必要时沿用现有 E2E 的 Vite `createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })` + `ssrLoadModule('/integrations/shared/client.ts')` 加载方式；操作结束 `close()`。不因此安装新软件或新增上传程序。纯 Markdown CLI `integrations/agent-publisher/publish.mjs` 只支持单文件正文建稿／单独发布，不会上传附件、设置分类／封面，不适用于完整 MVP 路径。

## 预检与附件边界

1. 校验 `site` 为用户确认的原点，用 `normalizeSiteUrl`，生产只用 HTTPS；localhost HTTP 仅隔离测试。Token 只从 `token_source` 指定的已配置安全环境取得；没有来源则停止，不输出环境变量或 Token。
2. 只读取指定 Markdown；拒绝非普通文件、符号链接、非 UTF-8、空文件以及共享限制外的内容（当前默认 Markdown 上限 512 KiB）。标题复用 `titleFromMarkdown(markdown, 文件名)`，不扩展 frontmatter／天气解析。
3. 有本地媒体时，要求明确的 `attachment_root`。将笔记路径表示为根内相对路径，构造 `resolve: { mode: 'root', documentPath: '个人AgentOS/任务记录.md' }`。只在根内列路径等必要元数据，构造 `Attachment[]`（`path` 为根内相对路径、`file` 为 File）；先调用 `attachmentPlan`，只读取计划中的引用文件。目录权限不代表可以读取其它笔记正文。
4. 文件系统访问额外核对真实路径：笔记和引用附件都必须在授权根内，不跟随符号链接逃逸；独立 `cover_path` 是单独授权文件，可以在附件根外，但必须是普通文件。可先用空 File 作元数据描述符，再在 `readAttachment(asset)` 中读计划文件；读取前后检查类型／尺寸／身份，不能把零字节描述符当真实大小。复用 `attachmentFile` 和服务器限额校验。
5. 标准 Markdown 路径 URL 解码一次；wiki `![[...]]` 名按字面处理。`../自媒体/assets/文件.png` 在共同根内允许；越界、缺失、同名歧义报错。HTTPS 和本站 `/api/files/<id>` 不重复上传，不抓取远端内容。链接包裹图片和 HTML 媒体当前拒绝；缺少定义而未被 Markdown 识别的引用保留为文字，不能声称已上传。
6. PNG/JPEG/WebP 可能按站点既有链路缩小重编码；“原图比例”不保证保留上传字节或分辨率。GIF 保留动画；MP4 可播放性取决于编码；MOV 仅在浏览器支持编码时播放，H.264 样例已验证。音频／PDF 按现有 audio／file 块处理。不要放宽 MIME、大小、URL 安全验证。

## 有序写入

每次请求只发送到确认原点，`Authorization: Bearer <内存中的 Token>`，`credentials: omit`、`redirect: error`、`cache: no-store`。JSON 写请求使用 `Content-Type: application/json` 和 `Accept: POST_SCHEMA_ACCEPT`（共享常量值）。不将凭据／全文写入共享日志。

| 动作 | 实际接口 | 最小 scope／响应 |
| --- | --- | --- |
| 查看分类 | `GET /api/article-types` | 公开列表；按 `articleTypesResponseSchema` 校验 |
| 上传媒体 | `POST /api/media`，FormData 的 `file` 字段 | `media:write`；`mediaResponseSchema` 中 `media.url`、`media.mime` |
| 新建草稿 | `POST /api/posts`，`createPostSchema` | `posts:write`；`postMutationResponseSchema` |
| 修改元数据 | `PATCH /api/posts/<id>`，`patchPostSchema` | `posts:write`；必须传精确 `version` |
| 读取私有文章／列表 | `GET /api/posts/<id>` 或 `GET /api/posts` | `posts:read` |
| 发布完整草稿 | `POST /api/posts/<id>/publish` | `posts:publish`；`{ version, visibility: 'public' }` |

1. 如传 `category`，先从公开列表按 ID 或名称明确匹配；歧义时询问。不调用分类创建接口，不修改全站设置。传 `categoryId` 时服务器使用目录名称，本 skill 不走任意自由文字兼容入口。不传则新稿不分类。
2. 先完成正文引用计划和独立封面格式预检。封面必须为服务端允许的图片，不能用视频或 PDF。若提供封面，调用 `uploadAttachment({ site, token, file: coverFile, signal })`，使用真实回执 `url`／`mime`，确认 MIME 是受支持图片。上传不等于已设封面。
3. 调用 `createDraftWithAttachments({ site, token, title, markdown, assets, resolve, readAttachment, signal, cache })`。客户端完成去重、上传、替换、MIME 转块，最后只建私有草稿。保持同次操作的 File 身份和 `cache`，避免已确认成功的附件重复上传；取消／来源变化不能继续保存。不能把相对路径原文直接传旧 `createDraft` 或 POST API。
4. 取得真实 `{id, version, visibility: 'draft', studioUrl}`。写权限 Token 可能只返回 `{post: {id, version}}`，这是合法回执，不必扩大读权限。若有分类或封面，用 `patchPostSchema` 校验后 PATCH **仅相关字段**。以下为实际 JSON 结构，URL／ID／版本必须替换成真实值：

   ```json
   {
     "version": 1,
     "categoryId": "ai",
     "coverImage": "/api/files/returned-media-id",
     "coverSettings": {
       "aspect": "original",
       "fit": "contain",
       "focusX": 50,
       "focusY": 50,
       "zoom": 1
     }
   }
   ```

   未传分类则省略 `categoryId`；未传封面则同时省略 `coverImage`、`coverSettings`。`ai` 仅示例，须确认目标分类存在。版本取本次真实回执，不硬编码。用 `postMutationResponseSchema` 校验响应 ID 相同，取新版本，不能用旧版本发布。
5. `status` 省略或为 `draft` 时结束。仅明确 `public`、全部写入成功且最终稿符合已授权内容时，调用 `publishPost({site, token, id, version: 最后成功回执版本, visibility: 'public', signal})`。有 `posts:read` 可核对最终稿，但不自动扩权。未知状态或服务器已变化时停在草稿，不发布未审阅更新。

封面设置不改文件内容；[首页 HomeCover](../../../../src/components/content/HomeCover.tsx) 仍按位置画框裁切、复用焦点／zoom。此处 `zoom: 1` 不承诺首页完全无裁切。

## 失败和已有文章

- 缺附件、歧义、上传失败／取消：保留源文件，终止后续步骤。已有媒体或草稿可能已保存，逐阶段报告，不自动删除。取消不能撤回已送达服务端的写入。
- 超时、网络失败、异常回执：先核对目标、已知媒体 URL 和文章 ID；有授权读权限时查文章，否则由用户在 Studio 核对。无 ID 的不明建稿通过 Studio 或授权列表核对，不盲重试 POST，不伪造幂等保证。媒体库列表当前仅作者可用，不能假定 `media:write` Token 可列库。
- 401／403：只报告缺少授权，不取浏览器凭据或创建 Token。409：保留输入、重审冲突稿，不能自动推进版本。413／415／422：报告格式／尺寸／内容问题，不放宽验证。失败不继续 publish。
- 另行授权修改已有文章时：先用 `posts:read` 审阅指定 ID／版本，PATCH 仅授权字段并 CAS。发布整份草稿可能同时发布既有未发布修改，需明确整稿发布授权；默认不能按标题查找覆盖。
- 只用合成文件和离线 schema／模拟 fetch 或隔离实例验证本 skill，不执行生产上传。原生 Obsidian 应用 E2E 未测；共享客户端／浏览器的证据不能冒称原生插件全流程。
