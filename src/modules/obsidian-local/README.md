# 浏览器本地 Obsidian 保存

本模块是**网站当前稿 → 本机 Markdown 和附件**的主动保存适配器，不是后台同步服务，也不改变现有 Obsidian → 网站发布插件。没有新增后端 API、令牌或守护进程。

## 使用

1. 设置 → **同步 Obsidian** → 添加预设，浏览选择含 `.obsidian` 的 vault 根目录。名称可自定，默认文章子目录为 `笔记`、图片规则为 `../asset`。
2. 预设及真实目录句柄只存当前浏览器 IndexedDB。手填绝对路径不能授权；换浏览器/清数据需重选。不向后端上传目录句柄、路径或本地正文。
3. 在文章编辑器点 **保存到 Obsidian**，选择预设或临时位置，可浏览根目录内文章子目录。保存取点击当时的标题、正文、图片与封面快照；未保存的网站草稿也可导出，不自动发布。
4. 目录不存在时明确选择创建，或从系统 `documents` 位置重新选择；权限失效必须重新授权，取消即停止。
5. 完成后另点“在 Obsidian 中打开”。URI 只含仓库名及文件相对路径，不含令牌。系统是否成功唤起需用户确认；同名 vault 由 Obsidian 自身解析。

不含 `.obsidian` 的普通文件夹可以保存，但明确显示“未同步 Obsidian”，不提供假成功。浏览器不支持 File System Access 时仅提供普通 Markdown 下载，图片仍为网站链接，**不是完整离线导出**。外图受 CORS 限制，取图失败会停止完整保存，不绕过权限。

## 文件与身份

- 共享 [导出准备模块](../local-export/README.md) 负责快照、Markdown 和媒体清单；这里不重新实现文章权限、上传或媒体 ID。
- `contracts.ts`：Zod 本地预设协议；`presets.ts`：IndexedDB 事务、用户手势目录选择、vault 检测。
- `save.ts`：路径规范化、文件名安全处理、完整媒体下载、冲突检测和落盘。所有相对规则必须留在授权根内。
- 根目录 `.mademe-export.json` 记录文章 ID → 路径、媒体 ID → 路径及已写内容指纹。指纹只用于发现本地修改，不替换现有媒体 ID、不用于自研哈希命名。
- 原媒体名优先；缺少块原名时读取现有下载 API 的 Content-Disposition。陌生同名文件不会因为名字相同而认定同一资源；冲突追加稳定 ID 后缀，仍碰撞再编号。文件名限制 UTF-8 字节，并处理常见系统禁用字符。
- 再保存同篇复用记录；选择不同文章目录会在新位置保存并保留旧文件。改标题不强制重命名既有已跟踪路径。
- 本地文章已修改时先提示另存副本或明确覆盖；确认后下载期间若再次改动，提交前复核仍会阻止覆盖。旧图片被本地修改则新写另一文件，不覆盖它。
- 全部附件先下载成功，再写附件，最后以 File System Access writable close 提交正文，最后更新清单。不是跨文件系统事务：磁盘失败可能留下新附件；正文成功后清单失败也会报告失败，重试可能要求另存/确认。不会把已失败的半成品谎报为完整同步。
- 同站浏览器 Web Locks 串行化多标签保存，本页也全局排队；浏览器没有 Web Locks 时拒绝目录写入并提示普通下载。外部程序在最终检查与文件提交间的极短竞态无法提供操作系统级 CAS 保证；不同来源/浏览器同时操作同一目录不在锁范围内。

Markdown 转换本身有损；特殊块/样式需核对。平台视频和嵌入仅保留原链接，不下载平台内容。保存没有改变网站原稿。

## 验证

- `tests/local-export.test.ts`：共享准备协议与 Markdown 引用。
- `tests/obsidian-presets.test.ts`：授权能力、取消、路径拒绝和 IndexedDB 真正事务完成/失败。
- `tests/obsidian-filesystem.test.ts`：隔离 mkdtemp 真实文件读写，验证字节、重复保存、本地改稿和长中文同名附件；不是原生浏览器授权验收。
- `tests/obsidian-save.test.ts`：内存目录的完整保存、图片失败不改旧稿、本地冲突、同名媒体、下载期间新修改。
- `tests/ui/obsidian-local.test.tsx`：真实 React 弹窗与预设 CRUD，边界采用隔离替身。
- `tests/e2e/obsidian-local.spec.ts`：真实页面当前稿下载及 picker 不支持/取消分支。是否实际跑通见根验证记录；模拟授权不等于原生目录授权/Obsidian 宿主验收。

## 界面设计契约

设置与保存弹窗复用现有 `.button` / `.primary` / `.small`、`.button-group`、`.form-stack`、`.form-grid`、`.config-card`、`.form-hint` 及共享 Modal / `.modal-actions`。不使用裸按钮或浏览器默认 fieldset 边框，不定义本模块独立主题。busy 状态仍禁用输入与操作。样式接线测试与真实截图验收分开记录，详见 [样式修复报告](../../../reports/2026-10-28-obsidian-ui-style-consistency.md)。
