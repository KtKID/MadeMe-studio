# Obsidian Vault not found：完整打开链路排查（2026-10-28）

## 结论

**尚未定位可证明的网站实现缺陷，未修复原生 Obsidian 的 Vault not found。** 本次只补诊断回归和调查记录，不改生成链接、保存路径、预设配置或应用行为，不新增用户设置。没有把先通过的诊断测试称作 TDD 红绿修复。

用户已确认 TechNote 是仓库，并给出保存目录位于 `/Volumes/machub_app/fn_backup/TechNote/brain/01_笔记/`。这只是用户提供的路径证据；没有访问该设备或目录。已报告的失败 URI 是 `obsidian://open?vault=TechNote&file=brain%2F01_%E7%AC%94%E8%AE%B0%2FMadeMe.md`，目前无证据应将 brain 猜作仓库根。

## 已排除的网站链路

- `SaveButton.save` 使用当前真实目录句柄的 `name`，不是预设显示名、历史 `vaultName` 或已撤销的 `obsidianVault` 字段。
- `buildObsidianUri` 分别编码 vault 和 file，无二次解码；参数含中文、空格、&、+、% 的 DOM 测试保持原值。
- 真实 React SaveButton/共享 Modal 渲染的 anchor `getAttribute('href')` 与 DOM `href` 均完整保留 URI；点击没有 preventDefault，没有替换地址或清空结果。
- 编辑器 document 捕获保护 `editorLinkDestination` 排除非 HTTP(S)，站内配置 `installUnsavedGuard` 亦如此；两者在诊断点击中未拦截、不弹离开确认。
- `StudioShell.navigate` 代码明确排除非 HTTP(S)；性能代理只匹配 `.studio-nav`，不匹配此打开入口。
- 实际 `/studio/new`、`/studio/edit` 被 Studio 布局列为 protectedFormPage，禁用 Astro ClientRouter；常驻 StudioWorkspace 也未启用它。
- 共享 Modal 的 section click 仅 stopPropagation，不 preventDefault；React 安全 URL 处理不屏蔽 obsidian 协议。

新增的两项集成诊断使用真实组件和 DOM 事件，但存储使用测试替身。jsdom 输出 `Not implemented: navigation to another Document`，表明它不实现外部导航，**不是**原生应用已打开的证据。没有尝试以测试进程唤起 Obsidian。

## 仍需的最小证据

从本机 Obsidian 中已打开的同一个 MadeMe.md 执行“复制 Obsidian URL”，只比较链接的 vault/file 与网页生成值，不需正文、凭据或机器访问。如果一致，则应调查本机协议处理器/应用登记状态；若不一致，才以实际差异建立失败回归，再修改实现。不能拿臆测的根名称造红测。

官方协议说明 vault 可以是名称或 ID，file 相对 vault 根；绝对 path 可替代二者，但浏览器目录句柄不提供绝对路径，不能硬编码用户的设备路径来伪装通用修复。[Obsidian URI](https://obsidian.md/help/uri)

只沿保存路径祖先查 `.obsidian` 至多产生候选：自定义 config folder、残留或多层配置目录不能证明已登记身份，因此本次未扩大扫描。[Configuration folder](https://obsidian.md/help/configuration-folder)

## 验证状态

- 新增 2 项 DOM/click/历史字段诊断，原实现直接通过；没有红测，也没有实现修改。
- 专项：3 文件 / 40 项通过。
- 全仓 82 文件 / 652 项通过；check 240 文件，0 errors / 0 warnings / 5 既有 hints；build 与 HTTP smoke 通过。
- 未推送、未部署、未访问用户 Mac；原生打开问题仍待现场 URI 证据。
