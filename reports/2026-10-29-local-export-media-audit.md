# 共享导出媒体引用主动审计

## 可复现问题
- 编辑器带 caption 的图片可导出为 figure/img。原准备层只识别 Markdown 链接，追加重复图；原 img 仍指网站相对地址。
- 遗漏图片补链的 URL 含空格/不配对括号时，实际 Markdown 解析后目标截断或不再是图片；仅 Markdown 同样受影响。
- 四空格缩进代码中的示例被当图片目标改写，破坏原文。

先红：已安装 satteri 实际解析，3 failed / 17 passed；/tmp/obsidian-export-audit-red.log。之后 20/20 专项通过。另有目录层真实文件/HTML图片回归和 UI 仅 Markdown 回归，未用解析器绿替代原生 Obsidian 验收。

## 窄修
- 补链与重写目标统一编码空白、括号和尖括号等目标字符；兼容 Markdown 反斜线转义形式。
- 仅处理已知编辑器 HTML img 的带引号 src；解码属性实体用于匹配、写回时转义属性，保留 figure/caption 和其它属性，不改 data-src 或注释。
- 保护四空格/制表符缩进代码；保持既有行内及顶层围栏代码保护。
- 不访问磁盘/网络，不反向依赖 Obsidian 模块；网站原内容和媒体原名不改。

## 实机证据与边界
父任务通过实际 prepareExport/saveToDirectory 生成“带说明的图片验收.md”，官方 Obsidian 1.14.5 阅读视图实际显示一张绿色 SVG，caption“这段说明必须保留，并且图片只出现一次。”完整保留。因此无需把 figure 转换为其它结构。
这不是通用 Markdown/HTML AST 转换器：reference-style 图片、复杂嵌套 blockquote/list 代码、srcset/picture/source 与任意 HTML 不声明完整支持。只对本轮已知编辑器输出提供窄兼容，不宣称任意文章均无损。
