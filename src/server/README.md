# 服务端编排模块

负责将共享 Zod 协议与身份、文章、设置、媒体、模型服务组合为 HTTP API。数据来自 D1/R2；不使用浏览器 localStorage 代替持久化。

## 文件与边界

- `api.ts`：路由调度、身份/权限、同源检查、请求协议校验。
- `http.ts`：有上限的请求体读取、JSON 响应和统一错误包装。
- `runtime.ts`：最小 D1/R2 接口及运行时配置，不包含凭据默认值。
- `page-data.ts`：SSR 所需的可见内容。作者阅读已发布快照，编辑接口另读草稿。
- `settings.ts`：设置持久化与访客脱敏；不接受密钥配置字段。
- `tokens.ts`：单次显示随机令牌、存储 SHA-256 摘要、scope 和撤销。
- `rate-limit.ts`：D1 原子窗口计数，保护密码尝试及模型调用。
- `errors.ts`：可公开的错误；意外异常不向客户端返回堆栈或上游正文。

## 子模块

- [身份与访问控制](auth/README.md)
- [文章与版本](content/README.md)
- [数据库结构](db/README.md)
- [媒体对象](media/README.md)
- [模型适配器](ai/README.md)

## 运行时配置

`DB`、`BUCKET` 分别绑定 D1、R2。Sites 模式须明确设置 `AUTH_MODE=sites` 和 `OWNER_ID`，或在尚未知道站点身份 ID 时设置受信任拥有者的 `OWNER_EMAIL`。`OWNER_ID` 存在时优先且不回退邮箱。密钥只通过安全运行时配置提供，不提交到仓库。

`SESSION_SECRET` 至少 32 字符，供密码文章的签名 Cookie 使用。开发身份需要同时配置 `ENVIRONMENT=development`、`ALLOW_LOCAL_DEV_IDENTITY=true`、`DEV_OWNER_ID` 和匹配的 `OWNER_ID`，并且请求地址必须为 localhost/回环地址。

## 验证

`npm test -- tests/backend` 包含单元、真实 SQLite 迁移/事务、服务端冒烟和真实本地 HTTP E2E。此处 HTTP E2E 不等同于浏览器端 BlockNote 操作测试；浏览器测试由界面模块单独负责。
