# 根目录 Browse 专项复核与就近反馈

## 不混淆两项问题
用户明确报告的是保存预设/选择根目录，不是文章保存。前一个 adapter 补丁修复另一个独立、已红测证明的写入缺口，不能据此宣称此现场已解决。
截图显示设置编辑表单 TechNote / brain/01_笔记，不含错误区或保存成功证据；无法据截图证明本机直属 .obsidian 的存在与否。

## 代码与实测事实
根 Browse 按钮接入 browse：picker(documents) → 真实 verifyVault(chosen) → 验证通过才 setHandle。verifyVault 读取直属 .obsidian，create:false；不递归 brain，不写目录、不信任 isVault 缓存。TypeMismatch/权限/IO不当作不存在。此检查只证明目录存在，不检查配置内容或 Obsidian 登记表。
新增 5 个入口集成测试使用真实 verifyVault，不 mock 判定结果：缺直属标记但子 brain 有标记、同名文件类型错误、权限拒绝、新建非法目录、重复点击/取消。原生产实现不改即全部通过，UI 专项 58/58，日志 /tmp/obsidian-settings-root-real.log。因此本云端未复现“根 Browse 未判断”的报告，不能编造一个判定缺陷。
旧预设编辑直接显示已存句柄；拒绝新选择时按要求保留旧路径。这不等于新选择被接受。原错误在整个设置块顶部，截图裁切未包含，属于反馈易遗漏的风险，而非已证实现场原因。

## 窄反馈修复
根 Browse 失败提示放到根路径紧下方，沿用共享 Notice 错误样式。明确“未采用本次选择，仍保留原路径。”；没有原路径则提示重新选择。原始错误原因保留；取消仍是取消反馈。重新选择、编辑其它预设、重置会清旧错误。不改全局布局/校验规则/预设数据，不新增配置。
反馈结构红测 2 failed / 58 skipped：/tmp/obsidian-root-feedback-red.log。完整验证见 /tmp/obsidian-root-feedback-{tests,check,build,smoke}.log。

用户随后明确为新预设，并补充 TechNote 也有“.ob 文件”；原话未精确验证是否为 .obsidian 目录。不能再以旧预设解释其现场，也不能把 .ob 文件当 .obsidian 目录。原生 picker 在云浏览器受平台限制，不能验证用户本机实际选择过程。未访问 Mac，未推业务仓库或发布正式站。本次仅本地提交与独立 preview 源准备，父任务负责发布与浏览器验收。


## 后续明确要求：强制可见校验与本屏排版
根选择后显示“校验中…”；完成实际直属目录检查后才显示“根目录存在 .obsidian 目录，校验通过。”并启用保存；失败就近提示且禁用保存、不采用新根。编辑旧预设同样实时校验，不能由缓存 isVault 显示成功；新增重置清除状态。确认保存再次读取标记，失败撤下成功状态并保留数据。仅 .ob 文件不满足检查，合法双层仓库不被额外拒绝。
状态红测 1 failed / 60 skipped：/tmp/obsidian-root-status-red.log；布局结构红测 1 failed / 61 skipped：/tmp/obsidian-settings-layout-red.log。新增真实 verifyVault 成功/延迟/失败/确认时消失回归。已有用例同步等待真实编辑校验完成，不跳过安全断言。
布局只在 obsidian-settings 内：压缩说明、列表左名称路径右操作（可换行）、编辑区分隔、根路径与状态同组、文章子目录与图片规则两列，保存靠右。共享黄色主题与控件保留，无新配置/按钮，不以 jsdom CSS 合约代替真实视觉验收。
完整日志 /tmp/obsidian-root-status-{tests,check,build,smoke}.log。

最终业务验证：84 文件 / 713 用例通过；check 242 文件，0 errors / 0 warnings / 5 既有 hints；build 与 HTTP smoke 通过。CSS 约束验证换行与右对齐，移动端/原生授权不冒称已验。
