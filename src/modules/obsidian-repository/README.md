# 独立 Obsidian 导入仓库

后台设置 → **Obsidian 仓库**。MVP仅一条连接，与“同步 Obsidian”的笔记导出预设独立：不查询、不迁移、不复制旧预设，也不继承其授权。

- `connection.ts`：Zod定义连接 `{id, revision, name, handle}`；独立 IndexedDB `mademe-obsidian-repository` v1 / `connection`，单例active。原 `mademe-obsidian-local` v1 / presets 完全不升级、不迁移、不删除。只有事务complete才报告成功。
- `Settings.tsx`：用户点击原生只读picker选择/替换根，校验 `.obsidian` 后保存原生handle；不是字符串路径。清除需要站内Modal确认，仅删独立连接记录，不删文件/预设，不声称撤销OS权限。重新授权只请求read。
- 目录能力类型及纯picker/根校验复用obsidian-local的底层模块，不依赖预设ID或预设生命周期。导出原行为保持。
- 每次连接替换生成新revision；正常导入在读取、上传、应用前检查同一连接仍有效。同标签事件与跨标签BroadcastChannel使旧读取取消/旧导入窗口关闭；不支持通道时版本检查仍停止迟到结果。通知不带句柄、路径或正文。
- 仅当前浏览器/域名本地保存，handle不提交服务端settings PATCH；不同Site origin不会继承生产连接。不上传整库、不修改笔记、不新增本地服务/写权限。

完整路径处理及媒体支持见 [Markdown导入](../markdown-import/README.md)；验收目标见 [TODO](../../../docs/task/task-obsidian-repository-import.md)。设置连接后正常导入只选择一篇MD，自动列出实际引用的图/GIF/视频及远程链接。缺失/越根/同名歧义/权限拒绝明确停止，保留编辑器输入。

测试分别覆盖独立存储事务、无旧预设/删除预设、清除互不影响、连接切换、取消/竞态和真实浏览器/API。使用native OPFS句柄与受控picker不等于外部OS目录授权；当前云浏览器真实picker已由父报告NotAllowedError，不绕过，仍列为未验。原生Obsidian宿主未运行。
