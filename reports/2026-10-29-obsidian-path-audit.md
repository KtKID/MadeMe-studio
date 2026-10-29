# Obsidian 本地保存主动审计

范围：云端业务工作树、隔离临时真实文件系统、实际导出模块；父任务负责官方 Obsidian 1.14.5 实机与浏览器。未访问用户 Mac/vault，不推业务 GitHub、不碰正式站。fixture、Obsidian 安装包/profile/vault 仅在工作区 obsidian-qa，不进入业务源码或部署产物。

## 八类实证问题与修复
| 问题 | 复现/证据 | 修复 |
| --- | --- | --- |
| 括号目标断链（本地与远程） | 原名 图).png / 图(.png 的实际文件存在，Markdown解析URL截断或无图；外部URL含空格/括号补链也失败 | 编码目标中的括号/空白，文件原名保留（#兼容例外见下） |
| Obsidian不兼容文件/目录中的# | 官方1.14.5六种编码/链接候选全部找不到媒体；含#文件标题URI只处理但不切页 | 仅新导出basename #→_，正文标题/网站原名不改；旧#文件不改不删，生成兼容新副本并更新映射；目录不重命名，明确拒绝 |
| HTML figure图重复且原src未本地化 | 实际Markdown解析2张图，caption留在原远程图 | 就地重写已知quoted img src，保留caption，防重复；MD-only写完整网站URL |
| 缩进代码被改写 | 四空格代码样例中媒体URL变为本地地址 | 保留缩进代码原文，和既有行内/顶层围栏保护共存 |
| 换根仍沿用旧子目录 | 编辑预设换有效根后旧相对路径仍可保存 | 采用新的根选择后清空文章目录，要求在新根重新选；取消/验证失败保留旧选择 |
| 长下载期间复用图被删/改仍提交正文 | 真实磁盘两图：A复用核对后，fetch B时删除/替换A，原代码成功提交新正文 | 正文提交前再次核对本次全部附件存在性/摘要，变动则安全失败，不静默覆盖外改图片 |
| 同名目录阻断另名保存 | 目标“标题.md”其实是陌生目录，原代码TypeMismatch终止 | 视为basename占用，另名保存且不碰目录内容；父路径错误仍立即失败 |
| 下载期间已存在文章目录被删除却静默重建 | 实盘新文章首次保存时fetch删除文章子目录，原write阶段create:true重新造目录 | write仅使用前置已存在/明确创建的目录，删除则失败，不隐式重建 |

“父目录被替换成文件导致候选无限重试”是开发修复同名目录时追加的防回归，不冒称原用户版本独立缺陷。未将测试数当漏洞数。

## 红测记录
- /tmp/obsidian-path-audit-red.log：3 failed / 4 passed / 9 skipped，括号两例、同名目录失败；中文/空格/%、方括号、引号、嵌套URI等实盘对照通过。
- /tmp/obsidian-export-audit-red.log：3 failed / 17 passed，HTML caption重复、外部URL补链、缩进代码。
- /tmp/obsidian-root-binding-red.log：1 failed / 72 skipped，换根旧子路径未解绑。
- /tmp/obsidian-media-hash-red.log：1 failed / 18 skipped，旧#媒体映射继续复用。
- /tmp/obsidian-note-hash-red.log：3 failed / 19 skipped，新/旧#文章与两种保存模式#目录拒绝。
- /tmp/obsidian-reuse-race-red.log：2 failed / 23 skipped，复用附件删除/修改长窗口。
- /tmp/obsidian-parent-race-red.log：1 failed / 25 skipped，开发过程中防止同名目录修复扩大错误分类。

- /tmp/obsidian-directory-delete-red.log：1 failed / 26 skipped，未授权创建时下载期间文章目录删除仍被隐式重建。

测试中实际创建/读写/删除的是自有临时目录；Markdown用项目已安装解析器检查目标再读取实际文件字节。不只做mock字符串断言。权限异常、浏览器交互锁及取消仍辅以确定性adapter/UI模拟。

## 父任务实际 Obsidian / 磁盘证据
- 官方1.14.5隔离profile创建brain vault；未关闭sandbox或绕过安全限制。
- 调用实际prepareExport/saveToDirectory生成产物：新文件basename已兼容#，正文标题#仍保留；绿色SVG显示 MadeMe image path OK。
- 从Welcome经官方binary传入新生成URI，实际切至目标文章并正常显示图片。此为应用URI分发分段验收，不是浏览器协议注册/点击全链路。
- caption fixture阅读视图恰好一张绿色SVG，说明文字完整，无须转换figure结构。
- 重复fixture复用同一文件/附件；手加LOCAL EDIT MUST SURVIVE后实际抛LocalConflictError且内容保留；移走测试MD后原路径重建并cmp字节一致。
- 云浏览器根Browse未成功弹出受支持的OS目录选择器，FSA授权端到端仍受平台限制，未绕过。

## 未覆盖/保留边界
- FSA没有跨应用原子CAS；最后复核与write/close仍有窄竞态。正文、附件、manifest不是多文件原子事务，失败可能留下附件或正文/清单不一致；不承诺回滚。
- 未存站内的新稿使用临时UUID，首次站内保存改用服务端文章ID；跨ID本地导出可能生成第二MD，不自动迁移/合并身份。旧文件保留，不声称同ID幂等能覆盖此转换。
- 自定义Obsidian配置目录、残留/嵌套标记、同名已注册vault的歧义不能由浏览器可靠验证；只检查授权链与标准.obsidian，不读取应用登记表。
- 媒体HTML仅支持已知编辑器quoted img src；reference-style、复杂嵌套blockquote/list代码、srcset/picture/source及任意HTML不声明完整转换。
- 真实用户设备权限撤销、系统盘故障、浏览器原生授权/协议点击全链路未验；外部图片CORS/鉴权失败应明确失败，不称完整离线。
- 同内容Markdown/manifest仍重写、媒体仍先下载再hash；本轮没优化这类幂等成本。

最终完整日志 /tmp/obsidian-path-audit-{tests,check,build,smoke}.log。无新依赖、配置开关、插件或守护进程。

最终业务验证：84 文件 / 749 用例通过；check 242 文件，0 errors / 0 warnings / 5 既有 hints；build 与 HTTP smoke 全部通过。这仅对应列明自动化与实机分段证据，不是所有系统权限/应用/Markdown语法的全覆盖保证。
