# 浏览器端到端验收

所有页面与 API 请求使用相对路径，统一继承 Playwright 配置的 `use.baseURL`（父配置通过 `BASE_URL` 指定）。不在测试文件写入第二套地址或生产域名。

- `guest-smoke.spec.ts`：`@guest`，首页可读、工作台入口、窄屏无横向溢出。
- `author-flow.spec.ts`：`@author`，真实 BlockNote 编辑、草稿/发布快照隔离、软删除恢复、版本冲突。
- `editor-regressions.spec.ts`：`@author`，延迟保存继续输入、单段 Markdown 导入取消、作者首页不泄漏草稿、原地发布回读刷新、明确撤回发布。

作者用例必须使用隔离环境的显式测试身份；`/api/bootstrap` 未确认作者权限时直接失败，不使用 `test.skip` 把未跑场景算通过。测试创建带 E2E 标记的内容并尽力清理，不导入私人笔记。

这些文件是可运行的验收断言。是否真实执行必须以 Playwright 报告为准；接口单测或 SSR 冒烟不等于浏览器已验证。浏览器启动若受沙箱或登录权限阻止，报告具体限制，不换方式绕过。

`media.spec.ts` 使用 Canvas 生成可解码 PNG 并等待真实 `naturalWidth`，验证 640×480 原图和 1200×675 裁剪输出。由于当前媒体 API 没有删除端点，媒体验收会在隔离测试存储保留带 E2E 名称的原图与裁剪图，不能在生产资料库运行，也不宣称自动清理了全部媒体。

`settings-regressions.spec.ts` 对延迟 PATCH 中继续编辑、只提交 dirty 字段、两个窗口独立修改 mode/font 设计了真实界面断言。保存完成后恢复原 mode/font。设置回归应在隔离测试实例串行执行，避免其他并行验收修改同一全站设置。
