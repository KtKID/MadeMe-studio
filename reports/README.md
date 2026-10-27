# 工程交接报告

- [2026-10-27：Google 登录迁移排障报告](2026-10-27-google-auth-handoff.md)：目标、实现状态、安装阻塞证据、缺失项与新服务器验证步骤。Google 登录代码尚未通过完整验证或部署，不因提交报告改变状态。
- [2026-10-27：/login Referrer-Policy 导致 CSRF_REJECTED 修复](2026-10-27-login-referrer-csrf-fix.md)：`/login` 改为 same-origin，`/api/auth/*` 保持 no-referrer，未放宽同源校验。
- [2026-10-27：Workers fetch redirect:"error" 导致 google_failed 修复](2026-10-27-google-callback-redirect-fix.md)：改用 manual 并将非 2xx 视为失败；workerd 复现证据；版本 581ee00f 用户已登录成功。
- [2026-10-27：AI 提供商请求 redirect:"error" 修复](2026-10-27-ai-provider-redirect-fix.md)：AI 文本/图片下载改用 manual，非 2xx 视为失败并记录日志。
- [2026-10-27：统一日志接口与失败静默治理](2026-10-27-unified-logging.md)：新增 `src/server/log.ts`、强制脱敏与浏览器日志；审计并修复静默 catch。

每次修复都必须在本目录新增报告（现象、根因、修复内容、验证方式与结果、如何避免再次踩坑），并在此索引登记。
