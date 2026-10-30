# 本地 Harness API Key 与录制回放验收

## 宿主与本轮停止边界

现有独立预览托管在 Sites/Cloudflare Workers，不能直接运行 Codex CLI。已有工作区与 Coding Environment 是开发执行器，不等于已配置的受保护持久 Node 发布服务。此外，官方 App Server 认证文档没有因 `apiKey` 模式而豁免其托管限制。故本轮只增强独立本地 runner；云页面不接收 API Key、不尝试探测本机、不架设公共隧道，不用普通模型直调冒充 Codex harness。

需要云端可填 Key 的真正执行体验时，应另行选择明确受支持的官方服务方案及账户准入，不能把本次本地代码称作已完成该部署。

## 实现目标与隐私规则

- 用户未来在已配对的本地同源控制台输入 Key，字段为 password，提交即清空，不写浏览器存储。
- 启动参数强制 `cli_auth_credentials_store="ephemeral"`；向 App Server 提交 Key 前通过 `config/read` 检查实际有效配置，缺失或被覆盖则拒绝。Key 只经进程 stdin 的官方 `account/login/start {type:"apiKey"}`，不进 argv、环境变量、审计或 fixture。
- 默认任务是 `replay`。没有样本或任务类型/规范化请求/模型 ID/协议不匹配时明确失败；不自动转真实调用。
- 真实录制必须点击明确的计费操作。一次任务可能包含多次模型请求，不能保证只扣一次费用。失败、超时或结果不确定不自动重试。
- 仅录制界面明示的固定公开测试文本/图片提示词，拒绝任意私文；不声称正则能识别所有隐私。
- 记录限于白名单业务事件、关联关系、脱敏结果与经过校验的图片，不保存原始 RPC、auth/account、请求头、stderr、环境或历史会话。
- 录制通过完整性与敏感数据检查后才完成；回放只还原对应结果，不自动写博客文章或上传媒体。

## 真实但无认证的只读探针

2026-10-30 在父授权下，用已安装官方 CLI、新建临时 HOME/CODEX_HOME、最小环境进行一次短生命周期探针。只发送 `initialize`、`initialized`、`config/read`；实际返回 `hasStorageField:true`、`storage:"ephemeral"`。未发送 login/start、thread/start、turn/start，未传 Key，未调用模型。未记录完整配置；进程已退出、临时目录已清理。

它证明当前 CLI 可检查有效内存存储配置，**不证明真实 Key 有效或供应商调用已通过**。管理员策略、安装版本变化时仍须运行时失败关闭。

## 尚未执行

真实 API Key 输入、真实模型测试、真实首录和真实录制数据的回放，均留用户明确操作。仓库没有凭空放入一个“真实首次会话”样本。测试中的 synthetic fixture 只是离线回归，不是假装供应商返回。

依据：[官方认证](https://learn.chatgpt.com/docs/auth)、[App Server](https://learn.chatgpt.com/docs/app-server)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

## 安全回归与界面检查

新增测试先复现再修复：只读状态/回放不得唤醒 App Server、凭据存储不符拒绝认证、严格任务/turn 事件关联、秘密被拆到 delta 或 JSON 转义时仍拒录、录制写入中不提前交付结果/图片、结束后晚到事件不得污染记录，以及并发录制不可覆盖。真实运行期间仅显示固定状态，文字增量在录制完整校验后交付，不承诺实时原文流。

控制台使用实际构建资源在受支持静态预览中检查，包含 API Key、模型 ID、固定样本、明确计费录制和默认回放；当前页面明确显示服务未连接。没有用静态截图冒充真实登录/模型端到端。截图为 `api-key-replay-console-static.png`，没有真实凭据或个人内容。

模型 ID 与适配协议基线做严格匹配，不等于证明供应商别名对应的权重不变，或动态测得任意已安装 CLI 的版本。已存在的未知执行占位不会自动删除，失败重试必须先明确处理既有结果，不会偷偷再次付费。

## 最终自动验证

- `npm test`：107 个文件、920 个测试通过（含最后补齐的回放图片容量上限）；不是 920 次真实模型调用。
- `npm run check`：290 个文件，0 errors、0 warnings、6 hints。
- 独立 Harness 构建、博客生产构建、HTTP smoke 均通过。
- 日志：`/tmp/harness-replay-delivery-tests.log`、`/tmp/harness-replay-delivery-standalone.log`、`/tmp/harness-replay-frozen-{check,build,smoke}.log`。
- 关键红测日志包括 `harness-console-lazy-red.log`、`harness-recording-delta-secret-red.log`、`harness-recording-no-clobber-red.log`、`harness-replay-artifact-cap-red.log`。此前含未完成异步用例的失败轮次不计为通过，最终以上述冻结后运行结果为准。
