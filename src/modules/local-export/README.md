# 共享本地导出准备

本模块把**一次明确的当前文章快照**转换为 Markdown 与媒体清单，不访问目录、网络、Obsidian、用户凭据或后台状态。网站文章与媒体模块不依赖本模块；浏览器目录适配器消费其输出。

## 协议与调用

- `contracts.ts`：Zod 为唯一协议来源；`ExportSnapshot`、`PreparedExport` 与 `ExportMedia` 均由 schema 推导。
- `prepareExport(snapshot, origin)`：同步纯函数。`snapshot` 包含文章身份 `articleId`、当前标题 `title`、当前编辑器转换的**正文** `markdown`、同一时刻的 `blocks`、可选 `coverUrl`。调用者必须先捕获所有字段，不能混用迟到的服务器旧稿。
- 返回包含标题 H1 的 Markdown、媒体 `{id, url, name}` 清单及有损转换提示；不会改变传入对象或网站原稿。

## 媒体规则

- 递归遍历图片、附件、音频、视频与子块，封面也进入清单。漏转换的媒体引用显式补入正文。
- 仅当前站点 `/api/files/{id}` 识别为内部媒体 ID；外部图片以完整 URL 为身份。媒体名优先用块 `props.name`，缺少时保留 URL 尾段，下载适配器可进一步读取服务器原文件名。
- 同一媒体 ID 的绝对/相对 URL 别名合并为一个资源并统一正文引用；**不同 ID 即使文件名相同也不会合并**。文件名安全处理与稳定冲突后缀由目录适配器负责。
- 嵌入及已识别平台视频保留原始链接，不假装下载平台文件，并给出离线限制提示。
- `data:`、`blob:`、`javascript:`、带凭据 URL 或空媒体链接拒绝导出；由调用方统一记录错误并显示原因，不能静默缺图后报告成功。
- 外部图片仍属于必须处理的媒体，后续下载失败须中止完整保存；本模块不绕过浏览器 CORS 或站点权限。

## 验证

`tests/local-export.test.ts` 先写用例并观察因模块未实现而失败，随后实现通过。覆盖协议拒绝未知字段、当前稿与不变性、递归私图、ID 别名合并、跨站同路径、封面、平台链接、附件、不安全 URL 与空媒体。此层仅验证纯准备逻辑，不代表浏览器目录授权或真实 Obsidian 安装验收。

### Markdown 链接重写边界

`replaceMarkdownMediaUrl(markdown, from, to)` 重写内联形式的实际链接目标（`[文字](URL)` / `![图片](<URL>)`），不修改正文 URL、相似 ID、绝对 URL 的局部子串，也不修改反引号行内代码、顶层反引号/波浪号 fenced code（含未闭合围栏）及缩进代码示例。编辑器 HTML figure/img 的带引号 src 可就地改写，caption/其它属性保留，避免追加重复图；注释/data-src不改。

本模块面向当前 BlockNote 编辑器生成的 Markdown 和同一快照的结构化媒体块，不是任意原始 Markdown 的通用重写器。引用式图片 `![说明][编号]` / `[编号]: URL` 不由此函数重写；从 Markdown 导入后的内容须先经 BlockNote 的块转换及重新导出，媒体块漏出的内联引用会由准备阶段补全。外部调用者若直接传入未规范化的 reference-style Markdown，不能宣称所有原始引用已经本地化。


目标URL中的空白/括号由 encodeMarkdownMediaUrl 编码，Markdown转义目标可匹配。此模块不是通用AST重写器：复杂嵌套blockquote/list代码、reference-style、srcset/picture/source与任意HTML仍不声明完整支持。主动审计、红测与原生caption验收见[媒体引用审计](../../../reports/2026-10-29-local-export-media-audit.md)。
