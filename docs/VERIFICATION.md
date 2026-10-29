# V1 验证记录

记录时间：2026-10-26。结果针对本轮源码与测试环境，不是安全认证、生产 SLA 或真实提供商可用性保证。

## 已执行通过

- Vitest：**27 个测试文件、148 项测试通过**，覆盖共享协议、后端、编辑状态、设置与外观、运行时和索引策略。
- Astro 类型检查：**0 错误、0 警告、0 提示**。
- Astro + Cloudflare + React + BlockNote 生产构建：通过；编辑器产物存在较大分块提示，仍需后续真实设备性能评估。
- 生产依赖审计：本次 `npm audit --omit=dev` 为 **0 项已知漏洞**。这不是所有应用漏洞为零的证明，也不代表未来依赖状态。
- 外部集成：**19 项 Node 测试通过**，Chrome 与 Obsidian 打包通过，共享客户端 strict 类型检查及 Obsidian 官方 SDK 类型检查通过。
- 独立 HTTP 冒烟与 Worker 测试均从全新临时 D1/R2 启动，自动执行迁移中的 12 条命令并通过；SIGTERM 清理验证无残留进程。
- 真实本地 Worker + D1 + R2 HTTP 流程通过：创建、发布、保存未发布修改、读取旧发布快照、过期版本 409、64×48 PNG 上传下载、无 AI 配置 503、删除恢复、独立访客实例访问隔离。
- 私有预览部署成功。云端浏览器访问后台路径显示 ChatGPT 登录门，证明外层私有访问要求生效；未登录状态不能证明内部应用页面可用。

## 重要回归

- Astro 运行时配置从 `locals.env` 获取，不触发旧版 `locals.runtime` getter。
- 缺少或过短 `SESSION_SECRET` 时，密码发布在写入前失败，不改变草稿或发布快照；前端明确显示配置状态。
- 保存响应不能覆盖等待期间的新输入或清除新的 dirty 状态；Markdown 导入取消不覆盖单段正文。
- 只写 Token 不获得文章正文；恢复已发布内容不能绕过发布 scope。
- 媒体引用权限检查不再限于最新 1000 篇文章；旧文章引用仍可按权限读取。
- 非公开、密码、链接访问及不存在的文章不可索引；动态 HTML 不缓存私人状态。

## 尚未执行通过

### 浏览器 E2E（早期验证阶段记录）

早期已提供作者、访客、编辑器、媒体、设置回归用例，但直接启动 Chromium 受到运行环境 socket 权限限制；当时支持的云浏览器尚无登录状态。后续用户完成登录，实际云浏览器验证结果见本文件各增量章节。以下限制仅描述早期阶段，不代表当前仍被登录门阻塞：

- 不宣称 BlockNote 页面操作、Canvas 裁剪、移动端布局或视觉截图已完成验收。
- 不将未登录、浏览器启动失败或跳过用例记作通过。
- 不放开站点权限、不绕过登录门来获取“通过”结果。

### 外部模型与发布工具

AI 测试模拟上游官方协议，并验证响应校验、安全下载、超时与配置错误；没有使用真实模型凭据或进行收费生成。真实模型、区域、账户额度与返回格式仍需联调。

Chrome/Obsidian 代码已打包，但未在用户浏览器或私人 vault 中安装测试。外部 Token 客户端可能受到私有托管站点外层登录门限制，必须确认正式接入方式后再验收。没有自动生成真实访问令牌或导入私人文章。

## 测试先行记录

基础协议及后续关键回归留有先失败再修复的记录；部分初始研究、界面及集成原型早于追加测试先行要求。历史如实保留，不能宣称所有 V1 代码均严格测试先行。

## 复验入口

见根目录 `package.json` 的 `test`、`check`、`build`、`test:smoke`、`test:worker`、`test:e2e`、`test:integrations`。运行条件见 [部署与运行](DEPLOYMENT.md)，浏览器断言见 [E2E 说明](../tests/e2e/README.md)。请在隔离存储中运行写入型测试，不能指向真实文章或媒体库。

## 独立作者认证增量（2026-10-27）

- 33 个测试文件、177 项自动测试通过；类型检查无错误，生产构建通过。
- 原真实 Worker/D1/R2 流程、HTTP 冒烟与新增 `node scripts/test-author-auth-worker.mjs` 通过，追加迁移 0002 在隔离本地库应用成功。
- 新回归覆盖登录/退出、过期与配置轮换、会话撤销、CSRF、限流、Bearer 权限隔离、未配置/不支持 KDF 失败关闭、HTTP 不显示密码表单、SSR 表单显式 POST 与水合前禁用。
- 本地 Sites 身份夹具只验证应用协议，不证明生产身份分发器安全。独立 HTTPS 浏览器登录、生产 KDF/CPU 验收尚未完成，真实凭据与线上认证模式未配置或切换。

## 非登录补完（2026-10-27）

- 36 文件、215 项单元/后端测试通过；类型检查无错误，生产构建、HTTP 冒烟、Worker/D1/R2 完整流程通过。
- 真实 R2 范围请求验证 fixed/open/suffix 206 的精确字节、HEAD 空正文、416 长度、访客 GET/HEAD 404 不泄漏长度。
- 实际浏览器：测试图片设封面保存重载，Markdown 导出内容含标题/正文/图片链接；外观选项可选，放弃后全部原值恢复，未保存修改用户设置。
- Markdown 导入文件选择器取消未完整验证；音视频真实拖动、移动尺寸、实际 AI 与扩展宿主仍不能记为通过。
- 集成总包 0.1.0 基于已提交 8fd2243 隔离构建，包含三种工具与集成源码，19 项集成测试与解压 CLI 预检通过，不等于宿主安装验收。

## 性能专项最终阶段（2026-10-27）

- 247 项自动测试、check 无错误、生产构建、真实 Worker/D1/R2 HTTP 与冒烟通过。
- 同一已登录云 Chrome、1165×757、3 文章/3 媒体，四 tab 依次循环 10 轮，最终 40/40 的内容可交互与可见图片指标均小于 1 秒。
- 设置未保存取消/确认、Back 取消/确认及 Forward 的实际浏览器回归通过，临时设置未保存；快速三连点击实际间隔约 80–100ms，不当成低于 30ms 的竞态实测。
- 新部署首次加载 4007ms、三次 warm reload 为 2184/637/633ms，单列不混入切换达标率，不承诺所有首开小于 1 秒。
- 多文章仅有本地数据层微基准，不能冒充 1000 篇文章的真实浏览器切页验收。详细口径、原始数据及收益见 PERFORMANCE.md。

## 写作空间返回保护修复（2026-10-27）

- 根因：Editor 的站内返回为完整文档导航，之前只用 beforeunload 保护，因此浏览器显示离站提示。
- 当前标签同源链接与原地返回阅读统一使用站内 Modal；取消保留输入，明确丢弃仅放行本次卸载。下载、新窗口、修饰键和同文档 hash 变化不接管。
- 44 文件、254 项自动测试通过；check 无错误/警告（4 条 returnValue 兼容提示），生产构建、隔离 Worker/D1/R2 与 HTTP 冒烟通过。
- 已部署的云 Chrome 实测：新文章输入后左上返回显示站内提示；取消保留标题，侧栏媒体跳转提示可 Esc 取消；确认返回写作台，无二次原生提示；原地编辑返回阅读的取消/确认均通过。测试未保存输入、未创建或修改服务器文章。
- 用户 Mac 截图确认原始 beforeunload；云自动化浏览器旧版未呈现相同原生弹窗，因此不宣称 Mac 原生弹窗已由云端复现。独立 Playwright E2E 文件已增加但未启动执行。
- 真正刷新、关闭及跨文档浏览器历史返回仍保留原生防丢稿保护；设置及其他破坏性操作 confirm 不属于本次修复，不能声称全站所有系统弹窗已消除。


## 全站交互链路专项（2026-10-27）

- 入口与分支逐项见 [覆盖矩阵](INTERACTION-COVERAGE.md)，静态控件数量不当作行为覆盖率。
- 最终 53 文件、307 项自动测试通过；其中 5 文件、39 项 jsdom + React Testing Library 真实组件交互测试。API、BlockNote 与 Canvas 边界依用例隔离，不能冒充真实浏览器 E2E。
- 类型检查 167 文件无错误/警告，4 条 returnValue 兼容提示；运行时代码生产构建、隔离 Worker/D1/R2 与 HTTP 冒烟通过。
- 修复：编辑器迟到替换覆盖新输入、恢复后 CAS、AI 旧建议污染；媒体重复提交/初始读取覆盖；列表错误漏显/逐行操作竞争；令牌创建撤销竞争和错误诱导重复创建；模型重复请求；解锁空密码/重复提交。
- 部分用例明确先红后绿，部分为补回归，不宣称所有历史实现都严格 TDD。所有写操作测试使用隔离 API/数据；未创建真实凭据、调用收费模型或更改生产文章和设置。
- 真实云 Chrome 的不保存检查包括列表/公开搜索、媒体筛选/裁剪取消、封面添加移除/插图后丢弃、AI 未配置状态、危险嵌入禁用、历史空态、发布取消、令牌表单取消与设置分类。最终部署复验另补记录。
- 模型真实账号、外部插件宿主、移动/多浏览器、所有 BlockNote 动态菜单仍有验收缺口。

### 本轮部署后复验

- 运行时 GitHub 源码 `afce95b`，Sites 源码 `438d3fdd9c56a58ba628f632a03c9436f3ddca52` 于 2026-10-27 05:33 UTC 私有部署成功，身份/密钥/访问范围未变。
- 新打开的已登录云 Chrome 实测：列表草稿筛选；媒体生成未配置禁用与取消；设置主题面板；令牌创建表单空值禁用与取消；新写作临时标题返回的继续编辑保留、明确丢弃返回及无原生二次提示。临时输入未保存，服务器仍 4 篇文章，无新增令牌或设置修改。
- 迟到响应、重复提交与强制错误路径由隔离 DOM/接口测试覆盖，不声称在生产请求上注入延迟或故障。

## 浏览器本地 Obsidian 保存（2026-10-28）

- 全仓 78 文件 / 617 项单元、DOM 与真实临时文件系统测试通过；check 235 文件无错误/警告、5 条兼容提示，生产构建、HTTP 冒烟、真实 Worker/D1/R2 与 19 项外部集成回归通过。
- 新模块 54 项覆盖当前稿、目录句柄本机保存、取消/权限、媒体完整性、同名与 UTF-8 文件名、已有/新路径本地修改竞态、代码区保真、迟到预设、冲突确认及 fallback。
- 独立作者 Worker 的 3 项 Playwright 用例在 Chromium 启动阶段遭 `socket() failed: Operation not permitted (1)` 阻塞，未运行页面断言，不算通过；没有绕过限制。
- 原生目录授权/持久化与真实 Obsidian 唤起仍未验收；Node mkdtemp 字节验证不能替代。没有改私人 vault、部署、合并或创建真实凭据。详见 [实施与验收报告](../reports/2026-10-28-obsidian-local-save.md)。

## Obsidian 新界面样式一致性（2026-10-28）

- 修复裸按钮和默认 fieldset/legend 边框，复用现有按钮、表单、卡片与共享 Modal；没有新增全局 CSS 覆盖或业务行为。
- 4 项样式接线回归先红后绿，覆盖明暗模式及普通下载分支；全仓 78 文件 / 621 项通过，check 无 errors/warnings、5 hints，build 与 HTTP 冒烟通过。
- 原始截图已检查；实际组件静态视觉夹具被云浏览器 `data:` URL 策略拒绝，未绕过。修复后真实页面截图及移动端视觉仍未验收，不以 DOM 测试替代。详见 [修复报告](../reports/2026-10-28-obsidian-ui-style-consistency.md)。

## 本地写权限时机（2026-10-28）

目录选择改为只读；实际文章保存前查询 granted/prompt/denied，配置保存不请求写权限。先红后绿，最终78文件624项通过，check无错误/警告、5 hints，build与HTTP冒烟通过。系统必要授权仍保留，当前未完成真实Chrome授权弹窗验收。详见 [权限时机报告](../reports/2026-10-28-obsidian-write-permission.md)。

## Obsidian 配置站内确认（2026-10-28）

用户要求的“是否保存此预设？”共享 Modal 已实现，确认仅写 IndexedDB，取消保留输入、重复确认锁定、失败在框内可见且可重试。3项先红后绿；模块21项UI通过，全仓78文件626项通过，check无错误/警告、5 hints，build和HTTP冒烟通过。实际文件写入的浏览器必要授权仍保留，真实视觉/原生权限未验收。详见 [站内确认报告](../reports/2026-10-28-obsidian-preset-confirmation.md)。

## Obsidian 打开链接身份（2026-10-28）

保存逻辑/路径保持不变，打开URI改用用户明确配置的登记名称或ID和根确认；旧预设默认禁用猜测链接，保留复制相对路径。新增6项协议/URI和3项UI回归，全仓79文件635项通过，check无errors/warnings、5 hints，build及HTTP冒烟通过。真实应用登记名称/ID仍需用户确认，未完成原生Obsidian唤起验收。详见 [打开链路报告](../reports/2026-10-28-obsidian-open-vault-identity.md)。

## 撤回 Obsidian 额外配置（2026-10-28）

用户拒绝的登记名/ID、根确认checkbox和“未配置”提示/限制已移除；保留原预设流程、样式、站内确认及权限时机，兼容历史字段不丢数据。恢复原best-effort打开入口，不改变成功保存路径；原Vault not found仍未解决。先红后绿，全仓79文件634项通过，check无errors/warnings、5 hints，build及HTTP冒烟通过。未推送部署，真实宿主仍未验收。见[撤回报告](../reports/2026-10-28-obsidian-extra-config-withdrawal.md)。

## Obsidian 文字入口 hover（2026-10-28）

仅用写作快捷栏内专用选择器取消该入口的灰色悬停背景；其它按钮hover、键盘focus-visible、点击与busy不变。先红后绿，全仓80文件637项通过，check无errors/warnings、5 hints，build及HTTP冒烟通过。未推送部署；实际浏览器截图仍未验收。详见[悬停修复报告](../reports/2026-10-28-obsidian-trigger-hover.md)。

## Obsidian 弹窗样式边界（2026-10-28）

全量CSS cascade复现工具栏祖先规则造成按钮padding=0和hover文字/背景同token；桌面/移动规则收窄直属按钮，仅此保存Modal portal到body，未改共享Modal实现或其它弹窗交互。先红后绿；82文件643项通过，check无errors/warnings、5 hints，build与HTTP冒烟通过。覆盖light/dark、padding/标题/hover/disabled/focus、Tab/Escape/遮罩/焦点恢复/卸载及SSR。真实浏览器视觉待预览验证，未绕过权限，未推送部署。详见[边界修复报告](../reports/2026-10-28-obsidian-modal-style-boundary.md)。

## 删除本地导出文件后重新保存（2026-10-28）

先红后绿：文章 NotFound 不再与历史清单指纹误判为改稿；缺失图片实际补写。新增 7 项回归，包括权限/IO失败、陌生文件竞争和真实临时目录删除后恢复。82 文件 / 650 项通过；check 240 文件、无 errors/warnings、5 既有 hints；build 与 HTTP smoke 通过。不是用户设备/原生授权验收，未推送部署。详见 [删除后重存报告](../reports/2026-10-28-obsidian-deleted-file-save.md)。

## Obsidian 打开完整链路调查（2026-10-28）

新增 2 项真实 SaveButton DOM/click 诊断，覆盖历史预设字段不影响目标、中文特殊字符编码、编辑器及配置全局 click 保护放行。原实现直接通过，无可证明的红测，因此不修改实现，不冒称修复原生 Vault not found。专项 3 文件 / 40 项；全仓 82 文件 / 652 项通过，check 240 文件 0 errors/0 warnings/5 既有 hints，build 与 HTTP smoke 通过。jsdom 不实现原生协议导航；仍需应用复制的实际 URI 对比。见 [完整链路调查](../reports/2026-10-28-obsidian-open-chain-investigation.md)。

## Obsidian 真实 URI 仓库根定位（2026-10-28）

用户实际 URI 证明授权根与仓库根不同；真实 SaveButton 回归先红（期望 brain、收到 TechNote），后实现路径祖先链定位，保持磁盘保存位置不变。82 文件 / 661 项通过，check 240 文件无 errors/warnings、5 既有 hints，build 和 HTTP smoke 通过。最近 .obsidian 只是候选，不承诺残留/自定义配置/登记识别；原生应用待现场验收。未推送部署。见 [根层级修复](../reports/2026-10-28-obsidian-open-root-resolution.md)。

## Obsidian 仓库根选择校验（2026-10-28）

3 项入口拒绝回归先红后绿；新增共 6 项，覆盖新建/编辑/临时根、文章子目录豁免、权限及 IO 异常。专项 46 项通过，全仓 82 文件 / 667 项通过，check 240 文件无 errors/warnings、5 既有 hints，build 与 HTTP smoke 通过。仅检查直属 .obsidian，不扫描子目录，不改写历史数据；原生目录选择待现场验收。见 [根选择校验报告](../reports/2026-10-28-obsidian-root-picker-validation.md)。

## Obsidian 预设保存边界校验（2026-10-28）

补齐旧记录不 Browse 即可确认保存的漏项；先红 2 项再实施，最终新增 5 项，确认前重查直属标记，不写入无效配置、不删除旧记录、不请求写权限。全仓 82 文件 / 672 项、check 无 errors/warnings 和 5 既有 hints、build/HTTP smoke 通过。详见 [保存边界报告](../reports/2026-10-28-obsidian-preset-save-validation.md)。

## 公开短页页脚布局（2026-10-28）

公开 shell 缺少满视口纵向布局，先以真实 CSS 测试复现 3 failed/1 passed，再增加 min-height 与正文 flex；后台框架不改。最终 83 文件 / 676 项通过，check 241 文件无 errors/warnings、5 既有 hints，build/HTTP smoke 通过。jsdom 只验 CSS 契约，真实几何交独立预览浏览器验收；未部署正式站。见 [页脚布局报告](../reports/2026-10-28-public-footer-bottom.md)。

## 设置允许列表文案（2026-10-28）

浏览器观察到标签/说明与“勾选=允许”矛盾；代码绑定正确，仅修改meta文案。2项先红后绿，84文件678项通过，check242文件无errors/warnings、5既有hints，build/HTTP smoke通过；未自动同步预览或部署。见 [文案报告](../reports/2026-10-28-settings-allowlist-copy.md)。

## Obsidian 子目录选择与弹窗层级（2026-10-29）

用户两张截图已实际查看。先红2项再实现，新增7项覆盖子目录picker/取消/拒绝/越界/忙碌与单入口布局；全仓84文件685项、check242文件0errors/0warnings/5既有hints、build和HTTP smoke通过。E2E入口名称已更新，真实目录授权与截图验收交独立预览；未把受限本地浏览器称为通过。详见[修复报告](../reports/2026-10-29-obsidian-directory-picker-ui.md)。

### 子目录按钮同行视觉反馈修正

独立预览发现设置按钮在输入下方贴边，先红结构用例再改为同一可换行控制组、8px gap、按钮不收缩，图片规则保持另一列。84文件687项、check242文件0errors/0warnings/5既有hints、build/HTTP smoke通过。父实测保存弹窗入口和取消焦点正常；云浏览器picker被平台拒绝且UI反馈正常，真实目录选择仍未验收。详见同日目录选择报告。

## 同目录仅 Markdown 保存（2026-10-29）

存储/UI先红2项、布局先红1项，再实现checkbox和Zod本次选项。新增5项覆盖不取图、同篇幂等/媒体保留/切回完整保存、底部同侧换行、取消重置/切预设/忙碌。84文件692项、check242文件0errors/0warnings/5既有hints、build/HTTP smoke通过。真实原生目录授权/应用打开未验收；见[选项报告](../reports/2026-10-29-obsidian-markdown-only-option.md)。

## 2026-10-29：文章写入前仓库根检查
- adapter 红测：2 failed / 23 passed，日志 /tmp/obsidian-root-save-red.log。
- 新增真实临时目录标记删除、两种保存模式无写入、权限/IO传播、合法子目录及 Settings 真实 verifyVault 回归。
- 完整日志：/tmp/obsidian-root-save-{tests,check,build,smoke}.log；原生授权与 Obsidian 应用打开不在本轮通过声明中。

## 2026-10-29：根 Browse 专项复核
真实 verifyVault 的 Settings 入口新增回归，原实现 UI 58/58 通过；未在云端复现本机报告，不把文章 adapter 漏项当同一问题。就近错误反馈 TDD 红 2 failed / 58 skipped。日志 /tmp/obsidian-settings-root-real.log、/tmp/obsidian-root-feedback-{red,tests,check,build,smoke}.log。
后续强制三态校验与本屏分组：状态红 1 failed / 60 skipped、布局红 1 failed / 61 skipped；最终 84 文件 / 713 用例通过，check 242 文件 0/0/5，build/smoke 通过。日志 /tmp/obsidian-root-status-{tests,check,build,smoke}.log。

## 2026-10-29：根提示精简
精确单句与单 Notice 红测 1 failed / 64 skipped；确认弹窗不重复底层错误，权限/IO原因保留。日志 /tmp/obsidian-root-copy-{red,tests,check,build,smoke}.log。

## 2026-10-29：缺目录与保存完成状态
红测 2 failed / 2 passed / 71 skipped；区分文章/媒体缺目录、创建取消/失败重试、成功关闭、重复保存与迟到探测回归。日志 /tmp/obsidian-save-flow-{red,tests,check,build,smoke}.log。
