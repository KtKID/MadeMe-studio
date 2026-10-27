# 块编辑与发布模块

`Editor.tsx` 是后台与阅读页原地编辑共用的 React BlockNote 编辑器。只在客户端加载。支持原生斜线菜单/选择格式化、媒体块、自定义安全 embed、Markdown 导入导出、AI 选区改写、版本历史。

## 状态与协议

- 保存：POST 创建或带 `version` 的 PATCH，仅写草稿。
- 发布：先保存，再带最新 `version` 调用 publish；不把保存误称为发布。
- 冲突：409 保留本地文字，允许 Markdown 备份与明确确认后重新载入。
- AI：只有已配置服务端凭据才请求；建议先展示，用户确认后应用，不伪造成功。
- 离开：返回写作台、原地返回阅读和当前标签的同源链接先显示站内未保存对话框。取消保留输入，明确丢弃只放行这一次导航，不再叠加浏览器离站弹窗。保存事务中阻止跳转。
- 浏览器刷新、关闭标签、地址栏跳转和跨文档历史后退仍由原生 beforeunload 兜底，不能为了消除提示而静默丢失草稿。下载、新标签打开、页内锚点不触发站内离开确认。

## 测试

`tests/e2e/author-flow.spec.ts` 先设计真实 BlockNote 编辑、草稿与发布快照隔离、同编辑器原地修改和冲突用例。需要本地隔离作者身份与 Playwright 浏览器；运行情况以最终验证记录为准。

## 已补回归

保存事务使用 `editor-state.ts` 的编辑序号：响应只确认已提交快照，不覆盖等待期间输入的标题或链接，不误清新的未保存状态。发布沿用该快照序号并锁住整个保存/发布事务。Markdown 导入按实际内容判断，不以块数量判断空白。原地发布后返回阅读会重新请求服务端最新发布快照。

`tests/editor-state.test.ts` 覆盖延迟保存、发布时后续输入、单段/附件/嵌套导入覆盖条件；`tests/e2e/editor-regressions.spec.ts` 提供相应真实界面回归、发布返回、撤回发布用例。作者 E2E 必须有显式测试身份，缺少身份直接失败而不跳过。

阅读页作者入口使用轻量 SSR + client:load，不再为了显示按钮静态加载 BlockNote；主动打开后才通过 React lazy 加载完整编辑器，等待时有明确状态。编辑页本身仍为 client:only，以避免富文本浏览器依赖进入服务端执行。移动端 viewport 声明 resizes-content，键盘行为仍需真机验收。

`editor-navigation.ts` 将未保存确认与一次性卸载放行集中管理。`tests/editor-navigation.test.ts` 覆盖取消、确认、重复点击、保存中及恢复；`tests/e2e/editor-navigation.spec.ts` 覆盖返回按钮、侧栏链接和刷新保护，实际浏览器运行记录以交付说明为准。

## 交互链路竞态回归

载入最新版本、历史恢复和 Markdown 文件读取都捕获请求开始时的编辑序号。响应迟到且期间有新输入时，不替换本地正文/标题，不清 dirty；历史恢复已写入服务器时，仅跟进新的 CAS 版本。保存、发布、恢复、载入、导入、撤下发布与 AI 请求共用同步事务锁，避免同一事件批次重复写入。发布过程的可见性/密码选择固定，不能显示已经切换、实际仍发布旧选项。

AI 面板关闭/重开使旧请求的建议失效；改变处理动作会清除旧建议，禁止把旧操作的结果应用到新目标。单测见 `editor-replacement.test.ts`、`ai-request-state.test.ts`；真实 DOM 点击由 `tests/ui/editor-clicks.test.tsx` 覆盖，BlockNote 和网络在该层为隔离替身，不等于真实供应商或浏览器排版验收。

## 媒体上传失败提示

BlockNote 上传面板会吞掉 `uploadFile` 抛出的异常、只显示通用“上传失败”，块以空 url 留在正文里。`uploadFile` 因此先用共享的 `mediaUploadProblem()`（`src/shared/contracts.ts`，与服务端共用 `MAX_MEDIA_BYTES` = 25 MB 与 MIME 清单）做上传前检查：拒绝时写 `editor.upload_rejected` 日志（只含 reason/mime/size，不含文件名）并在编辑器提示栏显示中文原因；服务端拒绝或网络失败由 `api()` 记录 `api.request_failed` / `api.network_failed`，编辑器显示“上传失败：<原因>”。视频支持 MP4 / WebM / MOV（文案取自 `acceptedVideoFormatsLabel`），MKV 等需先转码。

## 嵌入与视频块文案

工具栏“嵌入”弹窗和 BlockNote 媒体面板（“从电脑上传 / 粘贴链接”）的支持清单、拒绝提示都来自 [src/modules/embed](../../modules/embed/README.md)。弹窗用 `parseEmbed` 实时校验，插入的是规范化后的链接。b23.tv 短链会提示作者粘贴完整地址。实时预览不写日志，点“插入”被拒绝时才写日志。
