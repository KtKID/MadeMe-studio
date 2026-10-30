# AI PR 审核被思考过程截断、没有发出评论

## 现象
PR #2 手动触发 `AI PR Review (MiniMax)` 后工作流失败，PR 下没有审核评论。日志：`MiniMax 返回为空`，`finish_reason: "length"`，content 只有一段没闭合的 `<think>`。

另：PR #2 与 main 有冲突，GitHub 无法生成合并提交，`pull_request` 事件不会触发工作流；这是 GitHub 的行为，不是脚本问题，只能手动运行或先解决冲突。

## 根因
- 模型换成 `MiniMax-M3` 后，思考内容计入 `max_tokens`。原上限 8000 被思考全部用完，正式回答还没开始就被截断。
- `reasoning_effort` 写死在代码里，`max_tokens` 也是魔法数。
- 截断时只抛错，PR 页面上看不到任何提示。

## 修复
- `max_tokens` 默认 262144（256K），`reasoning_effort` 默认 `high`（按用户要求），请求超时 15 分钟，job 超时 20 分钟。
- 三个值都可用仓库 Variables 覆盖：`MINIMAX_MAX_TOKENS`、`MINIMAX_REASONING_EFFORT`、`MINIMAX_TIMEOUT_MS`。
- 去掉思考内容时也处理没闭合的 `<think>`。
- `finish_reason === "length"` 或回答为空时，在 PR 下更新同一条评论说明“审核没有完成”及原因，再让工作流失败，日志里带 `finish_reason` 和 usage。
- 评论“有则更新、无则新建”抽成 `upsertComment()`。

## 第二次失败：响应头超时
- 现象：改成 high 后重跑，约 5 分钟后报 `UND_ERR_HEADERS_TIMEOUT`，PR 下仍没有评论。
- 根因：非流式请求要等模型想完才返回响应头；Node 内置 fetch（undici）默认最多等 5 分钟响应头，与 `AbortSignal` 的 15 分钟无关。网络错误也没有在 PR 下留言。
- 修复：改为 `stream: true`（SSE），逐块拼接 `delta.content`，记录 `finish_reason` 与 usage；HTTP 错误、流内报错、网络异常、截断、空回答都走 `failWithComment()`，先在 PR 下留言再让工作流失败。

## 验证
- 本地 `node --check` 通过；直接调用 MiniMax 接口，`max_tokens: 262144` + `reasoning_effort` 返回 200。
- 本地 curl 验证 MiniMax-M3 流式返回格式（`delta.content`，最后一块带 `finish_reason`）。
- 推送后对 PR #2 手动重跑，结果见交付记录。

## 避免再踩坑
- 带思考的模型，输出上限要按“思考 + 回答”估，不要沿用无思考模型的数值。
- 长时间思考的模型请求一律用流式，避免各层“等响应头”的默认超时。
- 调用外部模型必须检查 `finish_reason`，截断要当失败处理，并在用户能看到的地方说明。
