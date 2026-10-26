# 后端验证模块

运行：`npm test -- tests/backend`。要求支持 `node:sqlite` 的 Node 版本。

| 文件 | 覆盖 |
| --- | --- |
| identity.test.ts | 身份、明确拥有者、CSRF、scope、密码与脱敏单元测试 |
| posts.test.ts | 真实 SQLite 迁移、CAS、快照、修订、可见性、媒体与块校验 |
| settings.test.ts | 明暗/皮肤/字体协议、独立更新与兼容默认值 |
| smoke.test.ts | 服务端页面数据及无云绑定冒烟 |
| http.e2e.test.ts | 真实本地 HTTP 服务上的文章、媒体、密码、令牌、配置与缺密钥 E2E |
| support.ts | SQLite D1 边界适配器及 R2 对象存储替身 |

## 实际开发顺序

初始后端实现先于这些补充测试，不能声称最初完全采用 TDD。补充 HTTP E2E 实际发现了媒体异步拒绝绕过错误包装的问题，先保留失败再修复。新增明暗/皮肤/字体需求先编写四项测试，首跑三项失败，再实现并验证通过。

## 不代表什么

HTTP E2E 不是浏览器操作测试；R2 使用存储替身；付费模型未实际调用；Cloudflare 真实绑定仍需部署后独立验证。不要将以上范围外项目标为测试通过。
