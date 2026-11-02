# 导入改用独立 Obsidian 仓库连接

## 用户纠正及根因

用户最新明确指出导入不能依赖可删除的笔记导出预设。上一版8edfee4虽然完成了句柄复用，但把导入生命周期绑定到了预设，架构不符合本轮目标。本轮先写 [验收TODO](../docs/task/task-obsidian-repository-import.md)，在同一未推送分支上更正。

## 改动范围

- 后台新增“Obsidian 仓库”分类，仅MVP一条独立连接。用户明确通过read目录picker选择/替换、校验直属 `.obsidian`后保存原生handle，不能以字符串路径冒充可读取。
- 独立 `mademe-obsidian-repository` v1 / connection / active，本地Zod协议仅{id,revision,name,handle}。不升级/迁移原 mademe-obsidian-local v1/presets；不查询、不复制、不回退到旧预设。目录handle不参与服务端settings PATCH。
- 原picker和根校验函数原样抽到 `obsidian-local/directory.ts`，presets.ts原导出名称继续再导出；旧存储/协议/导出写权限不变。目录能力协议仍复用单一Zod来源。
- 新 `RepositoryImportButton.tsx` 与 `repository-import.ts` 替换旧Preset入口。选MD经根resolve确认位置，仅读取这篇引用的跨目录图片/GIF/本地视频；远程媒体保留，重复引用去重，逐项清单有名称/类型/相对路径/状态。未配置明确提示独立设置，不自动使用旧预设。
- 明确重授权只request read，清除连接只删独立记录，站内Modal解释不删文件/预设、不宣称撤销OS授权。事务complete才报告成功，失败保留原连接。
- 更换/清除后revision变化。读取/上传/应用前复核当前版本，单页事件和跨标签BroadcastChannel取消旧读/旧窗口；通道被浏览器禁用时记录脱敏日志并保留版本保护，通知失败不会把已提交保存误报失败。取消、切换、新增编辑保护保留。
- Settings接线与Editor独立hunks交接，不整树替换Site。没有新增npm依赖、服务端接口、凭据、数据库迁移或本地守护进程。

## 验证

旧预设入口不能显示独立仓库未配置提示的回归先观察失败，再实现独立链路；不把所有历史测试声称为严格先红。

- 120文件1057项Vitest全量通过。包含独立存储事务、无旧预设、不自动迁移、预设改名/删除不影响连接、清连接保留旧预设、更换根/清除期间迟到正文拒绝、权限失效/只读恢复、通知通道拒绝、取消及原导出回归。
- check无错误/警告，6条既有hints；build、23项Node客户端、Obsidian SDK check/build、Chrome build均通过。
- 最终浏览器9项按8+1执行全部通过；真实隔离Worker与HTTP smoke通过。第9项专门用现有后台设置保存旧预设→独立设置连接（原来未配置，没有自动迁移）→删除唯一旧预设→导入只选MD→自动匹配6处引用、上传4个唯一文件、保留1远程媒体→保存刷新、两个视频实际播放。然后保留新建的旧导出预设，更换到另一个独立根，读取其中同名MD与新附件而非旧根，再清除独立连接并确认旧导出预设仍在、导入准确显示未配置。
- 未开启trace时，原生OPFS测试曾在合成fixture准备阶段挂住/超时；独立开启trace执行成功。最终runner将8项普通上传回归与1项原生文件能力回归分为两个CLI/browser生命周期，原生组开启trace，全部通过；不降低断言、不改权限或用预装附件替代。具体浏览器底层原因未定位，不能把过程称为已查清/彻底消除的平台问题，也不隐藏此前fixture准备失败。

## 边界与交接

第9项通过设置UI将真实native OPFS句柄结构化克隆到真实IndexedDB，应用自己resolve/读取引用文件，上传/保存使用真实隔离Worker/D1/R2。系统picker返回受控，不能冒称外部OS目录选择与真实授权/权限过期恢复弹窗已验。父云浏览器真实picker返回NotAllowedError，本轮未绕过；Android真机与原生Obsidian宿主未测。

连接仅当前浏览器/域名，正式博客和独立Site不继承；用户须在Site的新设置明确连接一次。未在本轮恢复任何旧预设权限。

仅本地提交，未push/PR/合并/部署；父Site源5ab280d已有8edfee4，本轮增量包须保留Sites鉴权、构建/hosting配置、独立D1/R2及已保存草稿/样例。父集成后按官方流程发布同一私有Site。生产blog.ktkid.ai未操作。
