# 工程交接报告

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

每次修复都必须在本目录新增报告（现象、根因、修复内容、验证方式与结果、如何避免再次踩坑），并在此索引登记。
