# MadeMe Studio

面向个人作者的写作、内容管理与发布工作台。使用 **Astro + React + BlockNote + TypeScript**，所有业务请求与响应以 **Zod** 协议为单一来源；D1 保存结构化数据，R2 保存媒体。AI 服务于作者，不是访客聊天机器人。

## V1 能力

- 前台文章直接编辑与后台共用真实 BlockNote 编辑器；Markdown 导入导出、块编辑、版本历史、未保存保护。
- 保存草稿与正式发布分离；公开、链接访问、密码访问；版本冲突、搜索、分类、标签、置顶、回收站与恢复。
- 媒体上传、搜索、插入、封面与裁剪；附件访问依照已发布文章权限，不因上传而公开。
- 作者 AI 写作建议、选区操作与配图；建议确认后应用，服务端多提供商适配、模型发现及生成历史。
- 暖黄色默认设计：四种布局主题、五种配色皮肤，明暗模式与字体独立配置。默认微软雅黑优先，未安装时回退系统中文字体，不分发字体文件。
- 站点设置、导航、RSS、sitemap、SEO；自定义代码只在隔离沙盒预览，不注入公开页面。
- 最小权限、可过期且可撤销的 API Token；Chrome 选区剪藏、Obsidian 当前笔记发布、Agent Skill/CLI，默认只创建草稿。

不会自动访问、导入或公开私人 Obsidian 仓库，也不会自动安装扩展。

## 当前交付状态

V1 源码已集成，测试和构建记录见 [实际验证记录](docs/VERIFICATION.md)。已完成单元/服务端回归、真实本地 Worker + D1 + R2 HTTP 流程和外部集成协议测试。**浏览器端到端与真实模型账户联调尚未验收，不应视为生产可用性保证。**

[私有预览](https://mademe-studio-preview.goldenscarf5.chatgpt.site) 已部署，需使用获授权的 ChatGPT 账户登录。后台包含文章、新建、媒体、设置和外部连接页面。当前云端浏览器只能确认登录门，尚未核验登录后的编辑器页面。预览没有配置模型密钥；密码发布也需另行安全配置 `SESSION_SECRET`。

## 开发与验证

需要 Node.js 24 和 npm。首次安装及检查：

```sh
npm ci
npm test
npm run check
npm run build
npm run test:integrations
```

本地开发、数据库准备、作者身份和部署边界见 [部署与运行](docs/DEPLOYMENT.md)。真实 Worker 测试入口为 `npm run test:worker`，HTTP 冒烟为 `npm run test:smoke`；浏览器测试入口为 `npm run test:e2e`，需独立准备隔离实例与浏览器。不能将浏览器启动失败或未登录记为通过。

## 文档与模块索引

### 工程与验收

- [开发清单与执行约定](docs/DEVELOPMENT.md)
- [验证证据与未验收项](docs/VERIFICATION.md)
- [全站交互链路与覆盖矩阵](docs/INTERACTION-COVERAGE.md)
- [组件点击回归测试](tests/ui/README.md)
- [部署与运行](docs/DEPLOYMENT.md)
- [安全边界与限制](docs/SECURITY.md)
- [工程脚本](scripts/README.md)
- [测试总览](tests/README.md)、[后端测试](tests/backend/README.md)、[真实 Worker HTTP 测试](tests/worker/README.md)、[浏览器 E2E](tests/e2e/README.md)、[测试素材](tests/fixtures/README.md)

### 协议与服务端

- [共享 Zod 协议](src/shared/README.md)
- [服务端编排](src/server/README.md)
- [数据库模型](src/server/db/README.md)、[数据库迁移](drizzle/README.md)
- [身份、权限与密码访问](src/server/auth/README.md)
- [文章与发布快照](src/server/content/README.md)
- [媒体存储与访问](src/server/media/README.md)
- [AI 适配器](src/server/ai/README.md)
- [公开内容发现](src/server/discovery/README.md)
- [HTTP API](src/pages/api/README.md)

### 界面与展示

- [界面模块总览](src/components/README.md)
- [阅读页与工作台](src/components/content/README.md)
- [编辑器与发布](src/components/editor/README.md)
- [媒体库](src/components/media/README.md)
- [设置面板](src/components/settings/README.md)
- [外部连接面板](src/components/integrations/README.md)
- [共享组件](src/components/shared/README.md)
- [页面布局](src/layouts/README.md)、[设计系统](src/styles/README.md)

### 外部发布工具

- [集成总览](integrations/README.md)
- [共享发布客户端](integrations/shared/README.md)
- [Chrome 剪藏扩展](integrations/chrome-clipper/README.md)
- [Obsidian 插件](integrations/obsidian-publisher/README.md)
- [Agent Skill 与 CLI](integrations/agent-publisher/README.md)
- [集成测试与人工联调清单](integrations/tests/README.md)

- [独立作者登录界面](src/components/auth/README.md)

- [导航性能测量模块](src/modules/navigation-performance/README.md)

- [工作台常驻外壳](src/components/studio/README.md)、[会话导航与身份生命周期](src/modules/studio-navigation/README.md)
