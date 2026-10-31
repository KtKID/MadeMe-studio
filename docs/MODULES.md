# 模块说明索引

本页按当前源码目录列出模块职责和维护入口。目录有说明不等于功能已完成生产验收；详细实现以对应 README 和 Zod 协议为准，验证状态见 [VERIFICATION](VERIFICATION.md) 与 [reports](../reports/README.md)。本轮优先补齐[封面说明](COVERS.md)，其他模块不在本轮重写或逐一重新验收。

## 业务模块 `src/modules`

| 模块 | 职责 | 详细入口及文档状态 |
| --- | --- | --- |
| cover | 封面展示比例、完整显示/裁切、焦点、缩放、统一展示及调整器 | [封面规范与实现差异](COVERS.md)、[源码说明](../src/modules/cover/README.md)；本轮补齐 |
| image-delivery | 原图 ID 到响应式展示 URL、衍生 manifest、共享图片限额；服务端生成和安全缓存 | [图片衍生说明](../src/modules/image-delivery/README.md)；本分支实现，待部署验收 |
| article-types | 稳定类型 ID、名称与旧分类兼容、类型选择匹配 | [README](../src/modules/article-types/README.md)；既有说明 |
| config | 默认值、限额、部署配置及作者可调配置的唯一来源 | [README](../src/modules/config/README.md)；既有说明 |
| content-check | 编辑器与服务端共用的按块保存/发布检查 | [README](../src/modules/content-check/README.md)；既有说明 |
| embed | 嵌入提供方注册、URL 解析、渲染和安全允许规则 | [README](../src/modules/embed/README.md)；既有说明 |
| local-export | 当前文章快照到 Markdown/媒体清单的纯准备逻辑 | [README](../src/modules/local-export/README.md)；既有说明 |
| obsidian-local | 浏览器目录授权、预设与当前稿本机保存适配 | [README](../src/modules/obsidian-local/README.md)、[用户规则](OBSIDIAN-LOCAL-SAVE.md)；既有说明 |
| log | 服务端/浏览器日志接口与字段脱敏 | [README](../src/modules/log/README.md)；既有说明 |
| navigation-performance | 后台导航 readiness 与本地性能诊断 | [README](../src/modules/navigation-performance/README.md)、[性能记录](PERFORMANCE.md)；既有说明 |
| studio-navigation | 后台常驻面板的会话导航、历史与身份生命周期 | [README](../src/modules/studio-navigation/README.md)；既有说明 |
| publication-status | 比较已保存草稿与发布快照，派生未重新发布状态 | [README](../src/modules/publication-status/README.md)；既有说明 |

## 协议、服务端与入口

| 模块/目录 | 职责 | 说明入口 |
| --- | --- | --- |
| src/shared | 前后端及集成共用的 Zod 业务协议 | [共享协议](../src/shared/README.md) |
| src/server | API 编排、运行环境、HTTP/错误处理等服务端边界 | [服务端总览](../src/server/README.md) |
| src/server/auth | 作者身份、会话、文章阅读权限 | [身份与访问](../src/server/auth/README.md) |
| src/server/content | 文章仓储、草稿/发布快照、版本与引用校验 | [内容](../src/server/content/README.md) |
| src/server/media | 上传、原图存储与鉴权、展示图生成及交付 | [媒体](../src/server/media/README.md)、[衍生处理](../src/modules/image-delivery/README.md) |
| src/server/ai | 文本/图片提供商适配与模型操作 | [AI](../src/server/ai/README.md) |
| src/server/db / drizzle | 数据表模型及迁移 | [模型](../src/server/db/README.md)、[迁移](../drizzle/README.md) |
| src/server/discovery | RSS、sitemap、公开内容发现 | [发现](../src/server/discovery/README.md) |
| src/pages/api | Astro HTTP API 路由入口 | [HTTP API](../src/pages/api/README.md) |

这些目录已有说明；API 编排内尚未单独拆成目录的 token、限流等实现从服务端总览进入，不把索引视为每项已有独立详细设计。需要专项文档时再补，当前未逐一审核完整度。

## 界面、样式与外部集成

| 模块/目录 | 职责 | 说明入口 |
| --- | --- | --- |
| components/auth | 作者登录界面 | [README](../src/components/auth/README.md) |
| components/content | 公开首页、文章阅读、工作台文章列表 | [README](../src/components/content/README.md) |
| components/editor | BlockNote 编辑、导入/导出、保存和发布交互 | [README](../src/components/editor/README.md) |
| components/media | 媒体选择、上传、裁剪和图片生成界面 | [README](../src/components/media/README.md) |
| components/settings | 站点设置界面 | [README](../src/components/settings/README.md) |
| components/integrations | 外部连接与令牌管理界面 | [README](../src/components/integrations/README.md) |
| components/shared | 弹窗、下拉、提示及共用交互 | [README](../src/components/shared/README.md) |
| components/studio | 后台常驻外壳与面板协调 | [README](../src/components/studio/README.md) |
| layouts / styles | 页面框架、主题 tokens、响应式样式 | [布局](../src/layouts/README.md)、[设计系统](../src/styles/README.md) |
| integrations/shared | 外部发布共用客户端 | [README](../integrations/shared/README.md) |
| integrations/chrome-clipper | Chrome 选区剪藏 | [README](../integrations/chrome-clipper/README.md) |
| integrations/obsidian-publisher | Obsidian 到网站发布插件 | [README](../integrations/obsidian-publisher/README.md) |
| integrations/agent-publisher | Agent Skill 与 CLI 发布工具 | [README](../integrations/agent-publisher/README.md) |

以上均链接现存说明，不代表宿主安装、真实模型或生产权限已经联调通过。整体入口见[界面总览](../src/components/README.md)、[集成总览](../integrations/README.md)及[部署说明](DEPLOYMENT.md)。
