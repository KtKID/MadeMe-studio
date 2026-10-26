# 部署与本地运行

## 运行结构

Astro 服务端渲染及 API 运行于 Cloudflare Worker；D1 绑定名为 `DB`，R2 绑定名为 `BUCKET`。`wrangler.jsonc` 中的数据库 ID 是本地占位符，不能直接当成生产资源。`drizzle/` 仅包含结构迁移，不包含作者、文章或密钥种子数据。

生产构建生成 `dist/client` 静态资产及 `dist/server` Worker；`scripts/package-worker.mjs` 创建托管兼容入口，同时保留 Astro 原始入口。`.openai/hosting.json` 声明绑定，不应保存凭据。

## 本地开发

1. 使用 Node.js 24，在仓库根目录执行 `npm ci`。
2. 复制 `.env.example` 为 `.dev.vars`，仅用于本地隔离实例。该文件已被 Git 忽略，不能提交。
3. 应用本地迁移：

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run dev
```

默认开发服务只绑定 `127.0.0.1`。示例中的测试身份仅在回环地址、`ENVIRONMENT=development`、显式允许开发身份且作者 ID 匹配时生效。不要对公网开放开发实例，也不要将开发身份配置复制到生产。

`npm run build` 只构建，不会替生产数据库应用迁移。真实 Worker 冒烟和 HTTP E2E 均自动创建全新临时 D1/R2、应用迁移并启动测试进程，结束后清理。先完成构建，再串行运行 `npm run test:smoke` 与 `npm run test:worker`，预留回环端口 4321/4322；无需提前启动开发服务。详见 [Worker 测试](../tests/worker/README.md)。浏览器用例另需可用浏览器与隔离应用实例，配置方式见 `playwright.config.ts` 和测试目录说明。

## Sites 私有部署

当前预览保持仅授权用户访问，未公开发布。访问者先经过托管层 ChatGPT 登录门；登录门成功呈现不等于内部所有应用功能验收完成。

部署必须确认：

- D1 与 R2 已正确绑定。Sites 托管发布流程会在上传 Worker 前应用托管迁移；检查发布结果，不要求用户重复手工执行。其他部署目标仍需按各自受支持的数据库流程应用迁移并记录结果。
- `AUTH_MODE=sites`，并明确绑定 `OWNER_ID`，或绑定可信拥有者的 `OWNER_EMAIL`。配置作者身份不意味着任意第一个登录者成为作者。
- 上游身份分发器清除客户端伪造的同名身份头；不能把仅信任头部的原始 Worker 公网入口直接暴露。
- `OWNER_ID` 优先于邮箱，没有匹配时不会回退认领。
- 环境值通过托管平台安全配置，不放入源码、构建压缩包、客户端或日志。

正式迁移前先备份现有数据库并确认目标，不能将本地测试数据或私人笔记当作部署种子。当前测试不替代正式环境的迁移、备份恢复与运维检查。

## 密码文章

通过安全运行时配置提供至少 32 字符的 `SESSION_SECRET`。不要使用文档示例、公开字符串或开发占位值作为真实密钥。未配置时公开/链接文章仍可发布，密码发布明确返回配置错误，不能悄悄降级为公开。

本轮预览没有配置此密钥；未创建持久凭据。之后设置或轮换应通过受控配置流程完成，不能把值发到项目 Issue 或提交记录。

## AI 提供商

按实际使用的提供商配置对应值，而不是同时填满所有项：

- `OPENAI_API_KEY`；图像可选独立 `IMAGE_API_KEY`。
- `OPENROUTER_API_KEY`。
- `SILICONFLOW_API_KEY`。
- `GEMINI_API_KEY`。
- `CLOUDFLARE_AI_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。

可选 `IMAGE_MODEL` 为图像模型默认值。文本与图片模型分别选择；账户权限、模型可用性与费用由提供商决定。设置面板只保存模型/提示词等元数据，不采集密钥。客户端不接受任意 base URL。

`SILICONFLOW_IMAGE_HOSTS` 如确有需要，须由管理员补充已核验的精确 HTTPS 下载主机；不要添加通配符、本地域名、IP 或未核验地址来消除下载报错。具体约束见 [AI 模块](../src/server/ai/README.md)。

当前未使用真实凭据联调，无配置时返回明确错误，不会生成假文本或占位图片冒充成功。

## 外部发布接入

Chrome、Obsidian 与 CLI 使用短有效期、最小 scope 的 API Token。真实 Token 由作者在工作台明确创建并仅显示一次；源码不预置令牌。它与托管平台的登录会话不同。

私有 Sites 外层访问门可能先于应用 Bearer 鉴权拦截外部客户端。不要为了联调擅自公开站点或绕过身份门；先确认正式托管的受支持 API 访问方式，再按 [集成检查表](../integrations/tests/README.md) 验证。默认只创建草稿，正式发布需独立权限及明确操作。

## 上线前检查

- 完整浏览器 E2E 和手机尺寸视觉检查。
- 授权作者身份、非作者访问、Token 到期/撤销及跨域请求。
- 发布快照、密码访问、媒体权限和旧文章附件读取。
- 数据库迁移、备份、恢复、容量和运行告警。
- 模型调用成本、额度、超时和失败恢复。
- 不含真实密钥、笔记、数据库或缓存的交付包与 Git 历史。
