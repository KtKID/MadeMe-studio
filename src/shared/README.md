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

## 安全回执与结构约束

`editorBlockSchema` 校验受支持 BlockNote 块类型、内联文字/链接及表格行列结构；畸形 JSON 在写入前被拒绝。`postMutationResponseSchema` 是完整文章与严格 `{id, version}` 回执的联合：write-only Token 不能通过写响应读取已有私密内容。

各端点响应（文章、设置、媒体、模型、令牌、修订、错误、确认）统一导出 Zod schema。`acceptedMediaMimeTypes` 是界面 accept 与上传验证的共用清单。

`accent` 是可空的自定义颜色覆盖，默认 null；null 表示恢复皮肤自带颜色，不影响 mode、skin 或 font。
