# 共享协议模块

`contracts.ts` 是 MadeMe Studio 的 Zod 协议单一来源。前端、HTTP API、集成客户端使用相同字段语义，不维护另一套隐式请求格式。

## 职责

- 文章、块内容、版本号、可见性、设置、媒体、AI 请求及 API Token scope。
- 请求采用严格对象校验，未知顶层字段返回 422；密码与密钥不进入 `Post` 输出。
- `mode`（明暗）、`skin`（配色）、`font`（字栈）相互独立。默认系统明暗、琥珀黄、微软雅黑；微软雅黑仅使用系统字体，不分发字体文件。
- `theme` 保留既有页面布局配置兼容，不作为明暗模式。
- PATCH 的新增默认字段显式使用 optional，防止 Zod 默认值意外覆盖其他外观设置。

## 边界与测试

此模块不访问数据库、环境变量或网络。运行 `npm test -- tests/backend/settings.test.ts` 验证外观协议；完整后端协议验证见 `tests/backend`。
