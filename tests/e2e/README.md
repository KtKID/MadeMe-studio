# 浏览器端到端验收

所有页面与 API 请求使用相对路径，统一继承 Playwright 配置的 `use.baseURL`（父配置通过 `BASE_URL` 指定）。不在测试文件写入第二套地址或生产域名。

- `guest-smoke.spec.ts`：`@guest`，首页可读、工作台入口、窄屏无横向溢出。
- `author-flow.spec.ts`：`@author`，真实 BlockNote 编辑、草稿/发布快照隔离、软删除恢复、版本冲突。
- `editor-regressions.spec.ts`：`@author`，延迟保存继续输入、单段 Markdown 导入取消、作者首页不泄漏草稿、原地发布回读刷新、明确撤回发布。

作者用例必须使用隔离环境的显式测试身份；`/api/bootstrap` 未确认作者权限时直接失败，不使用 `test.skip` 把未跑场景算通过。测试创建带 E2E 标记的内容并尽力清理，不导入私人笔记。

这些文件是可运行的验收断言。是否真实执行必须以 Playwright 报告为准；接口单测或 SSR 冒烟不等于浏览器已验证。浏览器启动若受沙箱或登录权限阻止，报告具体限制，不换方式绕过。

`media.spec.ts` 使用 Canvas 生成可解码 PNG 并等待真实 `naturalWidth`，验证 640×480 原图和 1200×675 裁剪输出。由于当前媒体 API 没有删除端点，媒体验收会在隔离测试存储保留带 E2E 名称的原图与裁剪图，不能在生产资料库运行，也不宣称自动清理了全部媒体。

`settings-regressions.spec.ts` 对延迟 PATCH 中继续编辑、只提交 dirty 字段、两个窗口独立修改 mode/font 设计了真实界面断言。保存完成后恢复原 mode/font。设置回归应在隔离测试实例串行执行，避免其他并行验收修改同一全站设置。

`navigation.spec.ts` 与 `studio-shell.spec.ts` 覆盖四 tab 不重复请求、真实 href 与历史补偿、设置放弃基线、隐藏后的身份重验、401后迟到响应、一次性 secret 清理。新增用例源码不代表本轮已跑浏览器；当前执行环境仅允许已授权浏览器通道，不启动独立浏览器绕过限制。Vitest 生命周期夹具与真实 Worker HTTP 作为独立证据报告。

## 网站 → 本机 Obsidian 导出

`obsidian-local.spec.ts` 在隔离作者实例验证：不支持目录授权时，真实 Markdown 下载包含当前未保存标题与正文；取消目录选择不写预设或站点设置；临时目标选择取消后保留当前稿、不显示保存成功。用例不创建服务器文章，也不读取私人目录。

```sh
BASE_URL=http://127.0.0.1:<隔离实例端口> npm run test:e2e -- tests/e2e/obsidian-local.spec.ts
```

前提：按部署文档运行独立本地测试实例并显式启用作者测试身份，`/api/bootstrap` 必须返回 `capabilities.authenticated=true`；已安装且获准启动 Playwright Chromium。身份缺失直接失败、不 skip。

目录选择器在此组测试中仅模拟“不支持”或“用户取消”，下载与页面交互是真实浏览器行为；这些断言**不等于真实 File System Access 授权、本机目录写入或 Obsidian 应用打开验收**。完整图片事务与冲突保护由 `tests/obsidian-save.test.ts` 的确定性目录替身验证；原生目录授权仍需支持浏览器中的人工验收。若 Chromium 因沙箱 socket 权限无法启动，记录 blocked，不能绕过限制或报告通过。

`npm run build && npm run test:e2e:obsidian` 可自动建立一次性作者 Worker/D1/R2，并运行这三项用例、最后清理。使用已安装的 Playwright 浏览器；若需系统 Chromium，可显式提供 `CHROMIUM_PATH`。不自动安装浏览器，不绕过系统权限。此命令不操作私人目录。
