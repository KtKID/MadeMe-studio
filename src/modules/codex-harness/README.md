# 博客的 Codex Harness 适配边界

本模块只依赖独立 `integrations/codex-harness/contracts.ts` 的 Zod 业务协议；不导入 Node、CLI、宿主路径、OAuth token 或认证文件。

- `adapter.ts`：宿主注入已授权的 `HarnessTaskPort`，将明确选区/图片提示词映射为白名单任务；校验回执任务身份。不自动重试、不上传整篇文章、不自动写回或发布。
- `readHarnessSuggestion`：只有任务真正完成才返回待审阅建议。生图必须有受验证的 artifact ID，助手文字“已生成”不算图片。
- `LocalHarnessNotice.tsx`：当前托管博客的真实状态提示。**没有实现云博客到本地 runner 的配对连接，不提供假登录按钮，也不自动探测 localhost。**

## 为什么独立本地控制台

Codex App Server 的 ChatGPT 浏览器认证用于本地/开源应用，不应作为托管博客共享订阅认证服务。OAuth 回调由 App Server 所在主机接收，用户浏览器必须在同机运行。Workers 也不能直接启动 CLI。

本轮可执行入口是 [独立本地控制台](../../../integrations/codex-harness/README.md)：用户以后在自己的电脑主动启动 runner、完成本地临时配对，再点击官方网页登录。博客已有 API-key 模型配置不受影响；两者身份与计费边界不混用。

本模块目前提供协议层适配，不宣称博客编辑器已能通过云页面直接调用本地 Codex。跨端连接须另外设计明确配对、浏览器私网权限和受支持授权；不靠放开 CORS、隧道或暴露无认证服务实现。

## 验证

- `tests/codex-blog-adapter.test.ts`：输入最小化、空选区、错误回执、失败传播、真实完成判定。
- `tests/ui/codex-harness-boundary.test.tsx`：设置页边界提示，不出现假网页登录按钮、不发出 localhost 探测。

本轮不自动补全，不同步 Obsidian，不配真实密钥，不进行真实登录或模型调用。
