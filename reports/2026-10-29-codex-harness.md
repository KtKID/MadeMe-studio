# Codex 本地 Harness 接入验收记录（2026-10-29）

## 交付边界

这是独立本地、单用户、开源应用的 App Server 适配，不是把 Codex CLI 放入 Cloudflare Worker，也不是在托管博客上共享 ChatGPT 订阅认证。官方 [App Server 认证说明](https://learn.chatgpt.com/docs/app-server#auth-endpoints) 限定本地/开源应用，并明确不适用于商业或托管服务。

本轮没有实际启动网页登录、完成 OAuth 回调、配置真实密钥、读取既有凭据内容或调用模型。离线 schema 从已安装 Codex `0.166.0-alpha.1` 的 `app-server generate-ts` 导出，只有协议生成，没有启动推理或登录。未来安装版本若改变协议，需要重新验证。

## 模块与调用链

1. `integrations/codex-harness/contracts.ts`：共享 TS/Zod 业务协议。
2. 独立 Node runner：受认证本地 HTTP → 白名单任务 → stdio JSON-RPC → Codex App Server。
3. 独立本地控制台：临时本机配对 → 官方浏览器登录 → 润色/生图任务 → 轮询、取消、查看真实结果。
4. `src/modules/codex-harness`：博客宿主注入传输的适配边界；现阶段云页面仅准确展示未配对状态，不自动探测 localhost，不托管登录。

用户第一次主动运行本地程序时，终端一次性入口用于访问授权；它不是 Codex 账户凭据。临时会话为 HttpOnly、SameSite，配对码不放日志或存储。登录则由用户另行点击官方链接，OAuth 回调仍由同机 App Server 接收。网站账号与 Codex 账号无关。

## 已覆盖的安全路径

- 白名单任务不接受任意命令、宿主路径、模型认证类型或 API key。
- 不继承宿主个人密钥；运行器使用显式独立目录；不放开 shell/任意审批。
- Host/Origin/请求类型检查、单次配对、防重放、会话过期、不启用跨域。
- 任务 requestId 去重，状态查询不重复推理；取消/超时/失联不自动重新提交。
- 图片必须由实际 imageGeneration 结果提供，通过目录/文件与类型/大小边界；普通助手文字不构成生图成功。仅有 fileId 且缺受支持下载方式时明确失败。
- 云端模型设置没有看似可用但无法完成回调的 Codex 登录按钮。

## TDD 记录

- 博客模型设置状态提示：先跑实际 UI 断言红 1，增加模块后绿。
- 适配器第一轮为缺模块导入红，不冒称运行时行为红；随后用例验证最小文本、匹配回执、失败传播及图片产物判定。
- 控制台初始缺模块红；后续错误脱敏、结果不确定的 requestId 保留、登录失败恢复/退出分别记录实际行为红绿。
- 核心运行器及安全审查日志见最终验收记录；测试只使用 fake App Server 子进程、临时文件和本地 HTTP，不使用真实账号。

## 待用户登录验收

1. 按独立模块 README 在用户自己的同一台电脑构建/启动，不在云博客环境启动。
2. 打开终端一次性本地入口；确认配对后地址片段被清除。
3. 点击“在浏览器登录 Codex”，再打开受验证的官方链接，由用户完成登录。
4. 确认账户状态；用非敏感文字做润色，并测试取消、退出。
5. 若当前账户/模型工具支持，提交图片任务；看到真实图片才算生图联调通过。缺工具、额度或仅 fileId 结果须明确报错，不用伪图兜底。

**尚未验证：**真实 OAuth、账户权限/额度、模型推理、真实 imageGeneration 工具、用户操作系统 CLI 安装、浏览器到真实本地进程的完整链路。云端到本地配对连接不在本轮实现内。未做自动补全或 Obsidian 双向同步；相关研究与此代码分开。

## 独立安全复核

审查用 fake RPC 复现了并发网页登录双发；补充并发锁与回归。另修复登录失败状态未恢复、提交回执不确定时错误换 requestId、取消时 turnId 尚未知、图片路径校验后读取窗口等边界。未知 turn 无法可靠中断时关闭专用进程并阻止继续提交，不声称后台任务已经成功取消或自动重试。

工具审批默认拒绝；启动时关闭 shell 工具并使用只读/任务工作目录沙箱配置。但**这些离线测试只证明发送了约束，不证明真实操作系统级完全隔离**。不防恶意同机用户；状态目录应由当前用户独占，不能放在共享可写位置。

## 最终自动验收

- 全仓 `npm test`：**103 文件 / 870 tests passed**。
- `npm run check`：**284 文件，0 errors，0 warnings，5 项原有 hints**。
- 独立 `node integrations/codex-harness/build.mjs` 与 `dist/start.mjs --help`：通过；没有启动真实 App Server。
- 博客 `npm run build`、`npm run test:smoke`：通过。
- 新核心测试 29 项、本地控制台 12 项、博客适配/边界 UI 6 项。
- 真实云浏览器仅打开受支持静态预览，查看无后端状态与任务切换：未连接时禁止提交；发现连接失败仍显示“检查中”后，补红测再修为“本地服务未连接”。静态控制台无真实配对或登录，不能作为登录/任务 E2E。

日志保存在当前工作区 `/tmp/codex-harness-final-{check,tests,standalone-build,build,smoke}.log`；静态截图位于工作区 `codex-harness-qa/local-console-disconnected.png`。临时预览与截图未加入业务源码；静态预览服务已停止。
