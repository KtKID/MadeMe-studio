# 工程交接报告

- [2026-11-02：PR11附件导入审核修复](2026-11-02-markdown-attachments-review-fixes.md)：独立媒体等待、取消兼容、链接包图拒绝、A/B来源竞态、wiki百分号字面路径及预检/区间扫描优化；990单测、6项浏览器/API验收。

- [2026-11-02：Markdown 附件导入 PR 交付复核](2026-11-02-markdown-attachments-pr.md)：独立私有 Site 实际保存/播放、磁盘文件选择额外流程未完成的边界，以及不混入 Sites 配置的业务分支范围。

- [2026-11-01：既有 Cloudflare Worker 生产配置准备](2026-11-01-cloudflare-production-config.md)：独立 production 绑定、保留 Dashboard 变量及路由设置、精确版本部署脚本；968 单测与离线 dry-run 通过，GitHub Actions 通过 needs:test 串接现有 CI，旧PNG测试在未改main复现后按现有WebP契约修正，完整Worker通过；独立PR审查未发布，用户确认保存 CLOUDFLARE_API_TOKEN_FOR_DEPLOY，名称元数据已核验，首次生产结果另核。

- [2026-10-31：媒体库删除按钮与 DELETE /api/media/:id](2026-10-31-media-delete.md)：引用检查 409 + force 二次确认，强制删除只清封面（草稿与已发布快照）、正文不动；删行→对象→衍生目录，失败记孤儿日志；单测/集成/真实 Worker E2E 通过，未合并、未部署。
- [2026-10-31：上传即缩到 960 WebP 落库，存量原图转换后删除](2026-10-31-media-store-960.md)：静态图按方向转正缩到 960 宽 WebP 只存一份，动画/视频原样；浏览器预缩小超限照片、衍生失败回退；一次性迁移脚本（生产 dry-run 10 张 4.7MB→358KB）；923 单测与真实 Worker E2E 通过；已合并（ab2c131）、部署（ae0f0825）并完成生产迁移（10 张，0 失败）。
- [2026-10-31：图片衍生与安全缓存](2026-10-31-image-derivatives.md)：保留原图、统一按需 WebP、公开/私有缓存隔离；910 测试及真实 Worker/浏览器回归通过，实际用户封面下载仍阻塞，未部署。

- [2026-10-30：首页三篇主次与四列文章网格](2026-10-30-home-featured-grid.md)：从实时 main 新分支实施默认刊物版面、响应式与真实浏览器验证；841 项单测、类型/构建、HTTP 冒烟和 Worker 流程通过；截图 Library 保存的网络阻塞单独记录。

- [2026-10-27：Google 登录迁移排障报告](2026-10-27-google-auth-handoff.md)：目标、实现状态、安装阻塞证据、缺失项与新服务器验证步骤。Google 登录代码尚未通过完整验证或部署，不因提交报告改变状态。
- [2026-10-27：/login Referrer-Policy 导致 CSRF_REJECTED 修复](2026-10-27-login-referrer-csrf-fix.md)：`/login` 改为 same-origin，`/api/auth/*` 保持 no-referrer，未放宽同源校验。
- [2026-10-27：Workers fetch redirect:"error" 导致 google_failed 修复](2026-10-27-google-callback-redirect-fix.md)：改用 manual 并将非 2xx 视为失败；workerd 复现证据；版本 581ee00f 用户已登录成功。
- [2026-10-27：AI 提供商请求 redirect:"error" 修复](2026-10-27-ai-provider-redirect-fix.md)：AI 文本/图片下载改用 manual，非 2xx 视为失败并记录日志。
- [2026-10-27：统一日志接口与失败静默治理](2026-10-27-unified-logging.md)：独立日志模块 `src/modules/log/`（服务端、浏览器、脱敏）；审计并修复静默 catch。
- [2026-10-27：工作台侧边栏显示作者账号名](2026-10-27-studio-account-name.md)：已登录显示账号邮箱，数据来自已验证会话 + `OWNER_EMAIL`，无迁移；会话 API 仅对作者本人返回。
- [2026-10-27：侧栏改为显示 Google 昵称](2026-10-27-google-nickname.md)：scope 增加 profile，ID token `name` 清洗后存入迁移 0004 的 `display_name`；昵称优先、邮箱回退；旧会话需重新登录。
- [2026-10-27：视频块 0:00 无法播放](2026-10-27-video-blocks.md)：空 url 被 safeUrl 补成 local.invalid；网页链接（Bilibili）被交给 `<video>`；BlockNote 吞掉上传失败原因。已修复渲染与上传提示，Bilibili 站内播放待决定。
- [2026-10-27：嵌入模块化与 Bilibili 播放器](2026-10-27-embed-module.md)：新模块 `src/modules/embed/`（YouTube / Bilibili / X 提供方注册表），编辑器、服务端校验、阅读页与 CSP frame-src 共用；cf-46630d 无需改数据即显示 Bilibili 播放器。
- [2026-10-27：支持直接上传 .mov](2026-10-27-mov-upload.md)：MIME 清单加 `video/quicktime`，`isQuickTime()` 签名校验（ftyp 或旧式原子）；按原 MIME 返回、`<video src>` 不写 type（Chrome 实测）；25 MB 上限不变。
- [2026-10-27：视频块粘贴 X 嵌入代码后发布“没反应”](2026-10-27-x-embed-silent-publish.md)：422 被发布弹窗遮住且为英文；新增 `src/modules/content-check/` 按块中文原因（编辑器预检 + 服务端 422），错误显示在弹窗内；嵌入代码解析与“改为嵌入块”；X 改为 Tweet.html iframe + 自适应高度 + 链接降级。
- [2026-10-27：配置模块与前后端限额对齐](2026-10-27-config-module.md)：新模块 `src/modules/config/`（C 级常量 / B 级部署信息 / A 级设置页可调，25 MB 只在 defaults 一处，硬上限 50 MB）；设置页四组配置带范围、默认值与恢复默认；修复 Markdown 导入、嵌套深度、slug、会话时长等前后端不一致；无 D1 迁移。
- [2026-10-27：工作台侧边栏底部精简](2026-10-27-studio-sidebar-bottom.md)：去掉“我的站点”卡片与底部标语（右上角已有“访问站点”）；账号入口距底边由 49px 改为 10px（CSS 变量 `--sidebar-bottom-gap`）。

- [2026-10-27：后台账号横向底栏对齐](2026-10-27-account-footer-alignment.md)：账号入口紧凑横排，左右底栏共享高度，保留认证逻辑；记录已通过的组件测试及依赖、浏览器验证限制。

- [2026-10-28：统一页脚产品版本](2026-10-28-product-footer-version.md)：统一配置显示版本 0.5，公开博客及后台署名居中，保留版权、RSS 与账号底栏高度。

每次修复都必须在本目录新增报告（现象、根因、修复内容、验证方式与结果、如何避免再次踩坑），并在此索引登记。

- [2026-10-28：网站当前稿保存到本地 Obsidian](2026-10-28-obsidian-local-save.md)：共享准备与浏览器目录模块，当前稿/图片、预设、修改保护及原生浏览器权限阻塞记录。
- [2026-10-28：Obsidian 本地保存界面样式一致性](2026-10-28-obsidian-ui-style-consistency.md)：修复裸按钮与 fieldset 默认边框，复用既有设计类；解释旧交互测试遗漏及真实视觉验收限制。
- [2026-10-28：配置阶段不提前申请文件写权限](2026-10-28-obsidian-write-permission.md)：区分 IndexedDB 配置保存与浏览器文件写授权，目录选择只读，实际写入前查询权限，拒绝不循环。
- [2026-10-28：保存 Obsidian 配置的站内确认](2026-10-28-obsidian-preset-confirmation.md)：复用博客 Modal，确认仅存 IndexedDB；取消保留编辑、重复确认保护和失败重试，不替代系统文件授权。
- [2026-10-28：Obsidian 打开链接登记身份](2026-10-28-obsidian-open-vault-identity.md)：不再用目录 basename 猜 vault；旧预设安全兼容，登记名称/ID与根目录显式确认，未确认只复制相对路径，不更改保存文件。
- [2026-10-28：撤回 Obsidian 额外配置](2026-10-28-obsidian-extra-config-withdrawal.md)：移除用户未要求的登记身份/checkbox/前置提示，兼容历史数据并恢复原 best-effort 打开入口；Vault not found 尚未解决。
- [2026-10-28：Obsidian 文字入口悬停底色](2026-10-28-obsidian-trigger-hover.md)：只取消编辑器该入口灰底，保留其它按钮反馈、focus-visible及交互逻辑。
- [2026-10-28：Obsidian 弹窗样式边界](2026-10-28-obsidian-modal-style-boundary.md)：直属工具栏选择器与本弹窗portal隔离，实际CSS cascade复现padding归零/hover同色；保留共享Modal行为，视觉验收单列。

- [2026-10-28：删除本地导出文件后重新保存](2026-10-28-obsidian-deleted-file-save.md)：区分磁盘缺失与本地修改，补回已删除附件，保留权限错误与竞争保护。

- [2026-10-28：Obsidian 打开链路排查](2026-10-28-obsidian-open-chain-investigation.md)：补 DOM/click/旧预设诊断，排除链接改写及站内拦截；未定位原生 Vault not found 根因，不冒称修复。

- [2026-10-28：真实 URI 定位 Obsidian 仓库根](2026-10-28-obsidian-open-root-resolution.md)：先用应用复制 URI 复现红测，再沿授权保存路径祖先定位最近配置目录，修正 vault/file，不改保存位置。

- [2026-10-28：选择仓库根目录时拒绝无标记路径](2026-10-28-obsidian-root-picker-validation.md)：先红后绿，校验直属 .obsidian，保留旧选择和编辑输入，不影响文章子目录或普通下载。

- [2026-10-28：保存预设边界重新验证仓库](2026-10-28-obsidian-preset-save-validation.md)：补齐旧记录直接确认可绕过 Browse 的遗漏，验证失败不写 IndexedDB、不删除原记录。

- [2026-10-28：公开短页页脚贴底](2026-10-28-public-footer-bottom.md)：先红后绿，用 min-height 和 flex 填补短页空白，长页自然流，不 fixed 遮挡正文。

- [2026-10-28：设置允许列表文案](2026-10-28-settings-allowlist-copy.md)：修正上传/嵌入标签与说明矛盾，保持禁用数组和安全值不变，先红后绿验证绑定方向。

- [2026-10-28：独立预览逐页点击验收](2026-10-28-preview-page-click-qa.md)：实际导航/面板/取消反馈、短长页页脚几何，明确导入只验选择器触发、完整导入/写入与目录原生授权未测，不泛化全链路通过。

- [2026-10-29：Obsidian 子目录选择与保存弹窗整理](2026-10-29-obsidian-directory-picker-ui.md)：预设子目录用只读路径与 picker，保存弹窗单一“其他位置”入口，保留授权校验和主操作。

- [2026-10-29：同目录仅 Markdown 保存选项](2026-10-29-obsidian-markdown-only-option.md)：checkbox默认未选，底部统一右对齐；选中不取图不写asset，保留媒体与安全清单，保存按钮同流程。

- [2026-10-29：文章保存边界重验仓库根](2026-10-29-obsidian-article-root-validation.md)：实际 adapter 写入前检查根标记，覆盖旧预设、标记消失及仅 Markdown，不误拒合法文章子目录。

- [2026-10-29：根 Browse 专项复核与就近反馈](2026-10-29-obsidian-root-browse-feedback.md)：真实判定入口测试原实现通过，不冒称复现现场；失败说明紧贴根路径，明确拒绝本次选择并保留旧路径。

- [2026-10-29：缺目录定位与保存完成反馈](2026-10-29-obsidian-save-completion.md)：区分文章/图片目录，同一主操作确认创建并保存；成功关闭弹窗，编辑器保留简短反馈与打开入口。

- [2026-10-29：新增预设目录未选择状态](2026-10-29-obsidian-unselected-directory.md)：去掉新增默认“笔记”，未选禁用保存，旧记录不迁移；附当前重复保存流程与非事务边界。

- [2026-10-29：共享导出媒体引用审计](2026-10-29-local-export-media-audit.md)：HTML caption防重复、特殊URL和缩进代码保真，明确非通用语法重写边界。

- [2026-10-29：Obsidian 主动路径审计](2026-10-29-obsidian-path-audit.md)：八类实证问题、真实磁盘红绿、官方应用分段验收与浏览器FSA/原子事务/身份边界。

- [2026-10-29：文章类型目录与选择](2026-10-29-article-types.md)：稳定 ID、旧分类别名兼容、即时新增、公开筛选与鉴权/并发回归。

- [文章类型同主题下拉修正](2026-10-29-article-type-dropdown.md)

- [已发布文章的有新修改状态](2026-10-29-publication-status.md)
- [2026-10-30：AI PR 审核被思考过程截断](2026-10-30-ai-review-truncated.md)：MiniMax-M3 思考用完 8000 token 上限；改为 256K、思考 high、可用仓库变量覆盖，截断时在 PR 留言并让工作流失败；改为流式请求避开 Node fetch 5 分钟响应头超时；之后按用户要求换成 GLM glm-5.3-flash（上限 128K）；另说明冲突 PR 不触发工作流。
- [2026-10-30：设置页服务商下拉改用同主题控件](2026-10-30-provider-dropdown.md)：AI 模型卡片“服务商”复用 `TypeDropdown`，值与保存逻辑不变；新增真实 DOM 用例。
- [2026-10-30：全站原生 select 替换为共享同主题下拉](2026-10-30-shared-dropdown.md)：`TypeDropdown` 泛化为 `src/components/shared/Dropdown.tsx`（支持禁用选项），替换设置、编辑器、媒体库、Obsidian 的全部原生 select；值与行为不变。
- [2026-10-30：共享下拉审核修复](2026-10-30-dropdown-review-fixes.md)：重选当前值不再触发 `onChange`（避免清空 AI 建议、重置提示词）；选项禁用状态变化时校正活动项；新增回归用例。
- [2026-10-31：首页刊物布局与封面比例合并整合](2026-10-31-home-grid-cover-merge.md)：合并 main 后 `HomeFeaturedPosts` 改用 `CoverFrame` 与 `coverSettings`，有封面时高度按文章比例；封面 e2e 字号种类上限 2→3；重点区高度对齐需人工确认。

- [2026-11-01：首页引言删除与精选布局诊断](2026-11-01-home-intro-and-featured-diagnosis.md)：删除横幅；本地复现混合比例与文字高度造成可见底部不齐，生产与输入截图访问阻塞，布局规则未改。
- [2026-11-01：首页位置封面本地预览](2026-11-01-home-layout-local-preview.md)：左 3:2、右侧及列表 16:9，标题完整显示与极长标题降级；真实浏览器截图，替代素材与 Library 上传阻塞明确标注，未发布。
- [2026-11-01：首页图片底边与标题首行对齐预览](2026-11-01-home-image-edge-preview.md)：左 3:2，右图按剩余空间均分，图片底边/日期/标题首行基线对齐；移除字符阈值，真实浏览器截图已保存 Library，未发布。
- [2026-11-01：首页布局正式提交](2026-11-01-home-layout-release.md)：删除介绍区，按图片底边/日期/标题首行基线对齐；整理封面回归和异步测量失效保护，不含预览文章或素材。

- [2026-11-01：PR8并发版本安全与冲突二选一](2026-11-01-editor-conflict-safety.md)：修复删封面错贴新版本，三方字段安全合并、正文整篇二选一；其中本地副本方案已由后续A/B版本撤回。

- [2026-11-01：冲突改为A/B选择，不额外存副本](2026-11-01-editor-conflict-ab.md)：保留严格版本校验和独立字段合并，展示两种状态、明确放弃未选冲突，验证失败/竞态及大量引用配额风险。

- [2026-11-01：Markdown 与 Obsidian 嵌入附件导入](2026-11-01-markdown-attachments.md)：显式附件选择、路径边界/去重上传/URL 替换、按 MIME 转块；真实混合 PNG/GIF/MP4/MOV 保存刷新播放及失败/取消/竞态保护，未部署。

- [2026-11-02：网页Markdown附件清单与选择累加](2026-11-02-markdown-import-guided-flow.md)：统一按钮、逐项识别/状态、分次多选累加/去重、明确冲突和替换移除；真实磁盘/浏览器保存刷新与手机视口，尚未部署。
