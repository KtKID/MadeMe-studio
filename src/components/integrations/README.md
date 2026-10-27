# 外部连接界面

`Integrations.tsx` 展示剪藏、Obsidian 与 API/Skill 的入口，创建/撤销独立最小权限访问令牌。密钥只展示一次，保存在组件内存，刷新后不会恢复，不放入 localStorage。

扩展和 Obsidian 安装属于独立集成模块，不会自动访问用户电脑或笔记库。外部源码链接需要仓库发布后才可用，部署验收时须核对目的路径。

## 待验证

无身份不能创建；令牌一次展示；撤销后调用失败；发布权限必须显式勾选；过期与无 scope 请求被服务器拒绝。

## 源码入口配置

`source-links.ts` 是安装说明、Obsidian 插件和 API/Skill 指南链接的唯一配置来源。当前已交付分支为 `feat/v1`，不能指向尚未包含集成目录的 `main`。未来更换发布分支时只修改该配置，并同步回归用例；这不代表授权合并或提升主分支。

`tests/unit/integration-source-links.test.ts` 渲染真实连接组件，核对三个入口均指向已交付路径且不再引用 `tree/main`。

## 首屏数据边界

连接页由服务器鉴权后提供 `initialTokens` 安全元数据，无令牌明文或 hash；已提供列表（含空数组）不再在 hydration 后 GET。`initialError` 明确呈现并标记导航失败。创建/撤销仍走原 API，未改变权限与撤销语义。
