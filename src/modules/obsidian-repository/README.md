# Obsidian 仓库与所属笔记预设

后台只有一处 **Obsidian 仓库** 管理。每张仓库卡片保留根信息与所属预设子列表；底部新增仓库，预设编辑在本卡片内展开，不替换其他列表。旧 `#obsidian-local` hash兼容转到此管理页。

## 数据与依赖

- `models.ts`：Zod定义仓库 `{id,revision,name,handle,identity,isVault}`；预设 `{id,revision,repositoryId,name,noteDirectory,imageRule}`。ID稳定，不按显示名合并。路径验证复用既有presetPathsRefinement，不复制规则。
- `store.ts`：规范化同源 IndexedDB `mademe-obsidian-workspace` v1，仓库/预设/meta三个store。根查询不读子预设，预设单向引用仓库。无预设、删某预设均不影响导入。只有事务complete报告成功。
- `connection.ts`：目录读取校验、read重新授权和仓库生命周期通知。导入明确选择根；多仓库不默认猜第一个，同名根显示短ID区分。删当前根取消旧导入，不自动切到别根；别根变化不打断已选根，预设CRUD不发根失效通知。
- `export-presets.ts`：使用预设时按repositoryId解析真实root，向原保存引擎提供临时兼容记录。预设不重复存handle。权限查询、子目录选择、保存及打开都使用解析后的同一root；保存前校验仓库/规则版本。多仓库不自动选择导出根，实际保存点击才申请readwrite。
- `Settings.tsx` / `repositories.css`：统一父子列表、规则编辑、新增只读目录选择、只删除站点活动配置的确认。网站按钮/Modal/Dropdown与既有主题一致。

## 两套历史数据的兼容迁移

`migration.ts`只读 `mademe-obsidian-local` v1/presets 的 `{preset,handle}` 及 `mademe-obsidian-repository` v1/connection 的旧单连接，不升级旧库、不先清旧数据、不跨origin、不读其他笔记正文、不请求目录或写权限。

只有 `isSameEntry === true`（或同一对象能力）证明同根才合并。不同根即使同名也独立；方法不支持/权限不足时分别保留，显示“历史目录待确认”。可以恢复read权限后明确确认保留为独立仓库，不悄悄重关联。

异步比较先在事务外生成计划，**新库仓库、所属预设与完成标记同一个事务提交**。并发迁移在写事务内重查完成标记；故障回滚、可重试，重复启动不重复建记录。跨两个旧源不能宣称跨库原子读取；这是一次兼容快照，不是旧版页面的持续双向同步，迁移后请勿继续在旧版页面编辑配置。旧源保留作恢复档案，正常界面以新库为准；完成标记防止删除后的仓库从旧源复活。未知/损坏旧协议明确失败并保留源，不静默丢项。

## 删除与权限

仓库删除确认列仓库名、所属预设数量/名称；提交时核对仓库revision和全部子规则revision。范围变化要求重新确认。新库同一事务级联，仅删该仓库及所属活动配置；取消不变。不删除磁盘目录、MD、图片/视频，不宣称撤销OS权限。单删预设不删root。

仓库与handle只在当前浏览器/域名本地保存，不进服务器settings PATCH。管理及导入只read；实际“保存到Obsidian”才沿用原write权限操作。Site不继承正式博客配置。

## 验证边界

验收TODO见 [最终结构](../../../docs/task/task-obsidian-repositories-and-presets.md)，导入格式见 [Markdown模块](../markdown-import/README.md)，导出文件/冲突规则见 [本机保存](../../../docs/OBSIDIAN-LOCAL-SAVE.md)。

原生OPFS句柄/真实IDB/真实隔离Worker上传保存可自动测试，但受控picker不等于外部OS目录授权；父云浏览器真实picker的NotAllowedError未绕过。原生Obsidian宿主、Android真机及外部OS授权恢复仍需独立验收。新增/迁移/删除功能测试全部使用合成配置，不代用户删除真实仓库配置。
