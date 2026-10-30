# 本地 Codex Harness

独立的开源、本机 Node 模块。它使用官方 Codex App Server 的标准输入/输出 JSON-RPC；不属于博客服务端，不要求博客持有 Codex 认证文件，也不向 Cloudflare Workers 塞入子进程。未来其他客户端可复用 `contracts.ts` 和本机 HTTP 协议。

**仅本地开源使用；不是托管 OAuth 服务或商用转售模型网关。** API Key 登录也不豁免此 App Server 托管边界；换成远程服务器或增加 TLS 不能直接公开本 loopback 服务。 网站作者账号、临时 runner 配对、Codex 的 ChatGPT 登录是三个不同边界。

## 当前能力与诚实边界

- `polish-selection`：本轮只允许固定公开测试样本做显式真实录制；默认严格离线回放。只有真实成功且录制落盘的 agent message 才作为结果。不会自动改博客正文、保存或发布。
- `image-generation`：提交实际生图任务，只接受完成的 `imageGeneration` 产物。文字声称“已生成”、SVG 替代品、任意下载 URL 均不能算成功。
- `capabilities` 表达适配器支持，不证明账户套餐、模型、工具或配额已可用。独立状态目录不会继承个人 Codex 插件/skills；若本机 Codex 没有生图工具，任务明确失败，不静默改用 API key。
- 支持同机网页 ChatGPT 登录和用户在已配对本地页面主动输入 API key；不支持 device code 或外部 OAuth token 注入。不自动打开网页，不后台登录。API key 只在 JSON-RPC stdin 的专用认证请求中传递，不放命令行、环境、日志或录制。
- 不包含 MCP server、外部 webhook、跨客户端自动同步或双向编辑。

## 文件边界

| 文件 | 职责 |
| --- | --- |
| `contracts.ts` | 唯一 Zod 业务输入/输出协议，不暴露任意 RPC、命令或宿主路径 |
| `transport.ts` | 专用子进程、逐行 JSON-RPC、超时和审批拒绝 |
| `runner.ts` | 白名单任务、内存状态、取消、幂等 requestId、结果归一化 |
| `artifacts.ts` | 仅当前任务目录的图片读取和内联图片校验 |
| `http.ts` | 仅 loopback HTTP、一次性配对、短期会话、同源校验 |
| `start.ts` | 用户显式启动的本地入口，默认不允许网页登录 |
| `console/` | 本地交互页面；不修改网站认证 |

## 本机运行（由用户以后执行）

要求 Node 24、Unix/macOS（当前启动器须能校验 uid/mode）、已安装的官方 Codex CLI、本仓库现有依赖。构建不启动 CLI、不登录、不请求模型：

```sh
node integrations/codex-harness/build.mjs
node integrations/codex-harness/dist/start.mjs --help
```

准备一个**归当前用户所有、不可被其他用户写入的空专用绝对目录**，不要放在共享可写目录；启动器要求 state/home/tasks 属于当前 uid 且 0700，遇已有不安全权限直接拒绝，不自动 chmod。目录标记不是防恶意同机用户的安全机制。不要指向个人 `~/.codex`、博客仓库或 Obsidian vault。下面只是运行格式，不包含任何真实凭据：

```sh
node integrations/codex-harness/dist/start.mjs \
  --codex /absolute/path/to/codex \
  --state-dir /absolute/path/to/local-harness-state \
  --browser-login
```

启动后只监听 `127.0.0.1` 的随机端口。启动只启动本机 HTTP 控制台，**不会启动 App Server**。默认回放和查看状态都不调用 Codex 或账户接口；仅用户主动设置 API key / 点击网页登录才惰性启动隔离进程。终端显示一次性本机链接：5 分钟有效，配对成功即失效；它不是 Codex token。浏览器立即从地址栏清除 fragment，以 HttpOnly、SameSite=Strict 的内存会话访问本地 API（30 分钟）。不要转发该链接。重启会失去会话、任务表和内存图片；磁盘任务文件不会被自动删除。

`--browser-login` 仅在**浏览器与 runner 同一台机器**时启用：官方 App Server 登录回调是其宿主的 localhost。云预览、远端服务器不能凭一个网页按钮替用户完成此本机回调；本模块不暴露端口、不架设 OAuth 回调代理。没有该参数时登录按钮应禁用，并解释同机要求。

只有点击本地页面的登录操作才发送 `account/login/start {type:"chatgpt"}`，再展示经过 HTTPS/官方主机校验的授权链接。认证交给官方 CLI 的 ephemeral 内存存储；启动强制 `cli_auth_credentials_store="ephemeral"`，提交认证前再读取 `config/read` 的 effective 配置，必须明确返回 ephemeral，缺失/其他模式一律拒绝。管理员策略可覆盖命令行，因此不能只凭启动参数宣称无持久化。网站、录制、日志不返回 key/token；退出或关闭进程清除运行时身份。退出仅调用本地 `account/logout`，不影响博客作者登录。

## API（同一共享协议，非任意 RPC 代理）

- `POST /v1/pair {code}`：单次临时配对；仅同 Origin JSON。
- `GET /v1/status`：仅缓存的连接/认证状态，不发起 RPC。`authMode` 为 none/chatgpt/apiKey；已配置不代表供应商、额度、模型已验证。另含 `loginStatus`/固定 `loginError`。
- `POST /v1/auth/api-key {apiKey}`：仅已配对同源本地页面可调用，Bearer 身份不可替代此权限，响应仅 ack。
- `POST /v1/login {}`、`POST /v1/login/cancel {loginId}`、`POST /v1/logout {}`。
- `POST /v1/tasks {requestId,kind,input,model,mode,recordConsent}`：返回任务，202。
- `GET /v1/tasks/:id`：只读恢复/轮询；没有自动重发。
- `POST /v1/tasks/:id/cancel {}`：请求中断，返回终态。
- `GET /v1/artifacts/:id`：鉴权后取得已验证 PNG/JPEG/WebP；不接受路径或外部 URL。

首次提交响应丢失时，用**相同 requestId 与相同内容**显式重试可取回同一任务；同 ID 不同内容返回 409。任务单串行，50 项内存上限；图片最多保留 5 项、每项 20 MiB。不能把服务重启后的同 ID 当持久幂等保证。

HTTP 可选接收运维自行提供的长 Bearer 凭证，但默认本地入口不用它、不生成持久密钥，也不把它注入浏览器。没有配对或 Bearer 配置不能创建服务。无通配 CORS；精确校验 Host、Origin、本机 socket，变更接口须 JSON，浏览器会话变更须同 Origin。配对最多 10 次尝试。

## 安全与失败处理

- spawn 使用固定 App Server 参数、`shell:false`；显式独立 HOME/CODEX_HOME，只传最小 PATH，不继承宿主 API 密钥、代理或用户认证环境。
- initialize 显式 `explicitGatewayOauth:true`，禁止隐式 gateway OAuth。正文 read-only，图片仅任务输出根 workspace-write；网络 sandbox 默认关闭、shell tool关闭、web_search显式disabled、cli_auth_credentials_store显式ephemeral并核对effective配置，不授予 unrestricted 模式。
- command/file 审批回复 `cancel`；其他交互/审批 RPC 明确拒绝，任务失败。没有“自动全部批准”。
- 这些是应用配置与沙箱请求，不是独立 OS 容器或完整主机隔离承诺；平台级 system skills/plugins 仍可能由所安装的 CLI 提供。真实 CLI 的沙箱与可用工具须在用户登录验收时核实，本轮未以真实模型验证。
- 不保存原始 stdout/stderr、Prompt、auth URL 或上游错误；HTTP审计只记录随机 requestId、归一化操作与状态码。
- 任务超时、进程中断、请求执行结果不确定均不自动重试。turn/start 尚未返回时取消或发生错误，将关闭专用进程隔离；interrupt 未确认也关闭进程。此时需用户明确重启，不能保证远端服务尚未计费，不能声称“从未执行”。
- 图片 `savedPath` 必须 realpath 落在当前任务 artifacts 根下；以 `O_NOFOLLOW` 打开、同句柄 fstat/有限读取，读取上限 MAX+1，拒绝目录、越界链接、超大和错误类型。仍不声称可对抗有权限改动整个宿主目录树的其他进程；本地同账号恶意进程不在 HTTP 隔离承诺内。
- 内联结果只接受受限 base64/data image + 魔数校验。仅 fileId 没有安全下载 RPC 时明确 `UNSUPPORTED_ARTIFACT`，不猜 URL 或扫描其他目录。魔数验证不是完整图像解码器。

## 验证

```sh
npx vitest run tests/harness/
```

本轮运行的是协议 fixture、真实 mock 子进程 stdio、真实临时 loopback HTTP、真实临时磁盘文件与 symlink 竞争用例。使用虚构配对码与账户响应，**没有启动真实 Codex 登录，没有读取个人认证文件，没有真实模型或付费调用**。构建与 `--help` 已执行；真实同机网页登录、账号可用性、润色质量、生图工具/产物仍待用户登录后验收。

依据：官方 [App Server 文档](https://learn.chatgpt.com/docs/app-server)；本机 `codex-cli 0.166.0-alpha.1` 离线导出的协议。App Server仍会演进，升级 CLI 后需重新核对 schema 和 fixture，不能只凭旧测试认定新版本兼容。

## 录制一次，之后默认回放

`mode` 默认 `replay`，`model` 是必填安全 ID。replay 找不到、版本/模型/请求不匹配、产物或事件不完整时明确失败，**绝不 fallback 到真实请求**。回放读取本地录制文件，不需要已登录账户，不会启动 CLI，也不会调用 account/read。

只有用户主动选 `record` 并将 `recordConsent:true`（确认这一次可能计费）才可创建真实任务；服务端同时要求已配置身份、固定公开样本与已校验录制目录。公开样本唯一来源是 `recording/public-samples.ts`，不会允许把私人文章或任意提示词录入 cassette。线程显式使用用户所选 model，模型权限要由真实执行结果确认。

`begin` 在真实请求之前独占预留请求指纹，已有成功录制或未知执行 `.pending` 都阻止再次真实调用。完整的成功、失败、取消事件和产物由独立 `recording.ts` 验证/落盘；中断、损坏或不完整不是成功 fixture。未知执行 pending 不自动删除，重启也不能据此重试模型。不要手工删 pending 当作“清缓存”。

真实任务期间只返回固定状态事件，文字 delta 缓存在内存中，完成敏感扫描且完整录制成功后才向页面交付文本事件、结果与不透明 artifactId；这是防止密钥被上游分片回显的保守措施，不宣称实时输出原文。`events` 有固定类型、seq、elapsedMs；回放保留已记录文本事件顺序和相对时间，不包含旧 task/thread/turn ID。录制保存中不接受新真实任务或取消变更已结束的终态。

本轮只使用虚构 key 与 fake App Server 做离线/本地 HTTP 测试，没有配置任何真实 key、登录或真实付费调用。父任务额外在无认证隔离进程只读验证了 config/read 能返回 ephemeral；这不等于完成真实账户或模型验收。
