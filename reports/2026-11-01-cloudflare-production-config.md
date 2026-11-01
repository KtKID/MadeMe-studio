# 既有 Cloudflare Worker 的生产配置准备

## 现象与边界

基线 `main` 为 `50d277c568f046ad3e6e7ebe216ec5eaaa9a400f`。生产 Worker 已存在，但仓库 Wrangler 默认 D1 ID 是本地占位符，不能直接接入默认自动部署。此轮补丁通过独立分支和draft PR审查；未合并或部署，未创建/读取/修改任何部署凭据，未运行生产迁移。用户后续选择 GitHub Actions；Cloudflare Builds 不连接。用户最终重建仅 author-studio 的 Individual Workers Editor token，已明确确认保存，最终仓库 Secret 名称为 CLOUDFLARE_API_TOKEN_FOR_DEPLOY；父任务通过GitHub仓库名称列表独立确认名称存在，更新时间2026-11-01 18:31 GMT+8，未读取值。此执行器不接触其值。

Mac 控制台核对的非敏感目标：`author-studio`、既有 `blog.ktkid.ai`、`DB → author-studio (c2758015-872a-454b-8915-68a8a662040c)`、`BUCKET → author-studio-media`、`ASSETS`、`2026-10-01/nodejs_compat`。运行变量和 secret 仅知名称，未收集其值。

## 根因与补丁

- `wrangler.jsonc`：默认本地占位配置保留；新增显式同名 Worker 的 `production` 配置、真实 D1/R2 绑定和顶层 `keep_vars: true`，不添加变量值、路由或访问开关。
- `scripts/deploy-production.mjs`、`package.json`：增加离线验证与未来发布入口。检查真实 Astro 生成的 `dist/server/wrangler.json`；上传版本后只发布 NDJSON 确认的本次 UUID，不按 latest 猜测，也不自动重试。只接受明确的 main 构建来源，额外/含糊模式参数拒绝。
- 发布使用 `versions upload` → `versions deploy UUID@100%`，不运行普通 deploy/triggers；切流量仅给临时 Worker 名称配置，避免 Wrangler 用生成配置覆盖非版本 observability 等设置。当前 Wrangler 4.153.0 的源代码与配置解析已核实这一行为；未用真实账户执行。
- `tests/production-deploy.test.ts`：10 项无网络测试，覆盖本地占位/错误目标/变量覆盖拒绝、dry-run 不发布、精确版本发布、缺 CI/上传失败/缺输出/重复输出/错 Worker/发布失败与确认缺失不报成功，以及 GitHub PR/fork/tag/非main/过时提交/API失败的拒绝。新增测试先红后改，见 `/tmp/mademe-actions-red.log`。
- `tests/worker/flow.mjs`、对应README：只修正与既有WebP落库契约相悖的旧测试断言。明确验证WebP文件名、MIME、RIFF/WEBP签名及元数据大小，Range/HEAD/416/私有鉴权继续按实际存储对象核对，MOV仍原样比较；不修改产品代码、不跳过检查。
- `.github/workflows/deploy-production.yml`：按后续授权新增唯一生产发布工作流，由原 CI 的 needs:test 在同提交 test job 成功后调用，main push 自动发布、手动运行 CI 也只允许 main 发布，只有 contents read；Action 固定官方 SHA；固定 concurrency group，不取消正在发布的任务。只在全部检查通过后的最后一步注入专用部署 token。脚本不再接受 Workers Builds 来源；用只读 GitHub API 核对最新 main 后发布。
- [部署文档](../docs/DEPLOYMENT.md#既有-cloudflare-生产-worker自动部署准备)、[脚本说明](../scripts/README.md)：Actions 的生产命令、专用 secret、权限范围和首次启用边界。

## 验证

本地 Node 24.19.0；锁定 Astro 7.4.2、Cloudflare adapter 14.4.2、Wrangler 4.153.0。

| 检查                        | 实际结果与证据                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新增部署单测                | Actions接入后10/10；`/tmp/mademe-actions-tests.log`                                                                                                                                                                      |
| 全量 Vitest                 | 110 文件、968 用例通过；`/tmp/mademe-actions-all-tests.log`                                                                                                                                                              |
| 集成协议测试                | 20 通过；`/tmp/mademe-prod-integrations.log`                                                                                                                                                                             |
| `npm run check`             | 0 errors、0 warnings、6 hints；`/tmp/mademe-actions-check.log`                                                                                                                                                           |
| 默认本地 build              | 通过，DB 保持占位；`/tmp/mademe-local-config-build.log`                                                                                                                                                                  |
| 默认产物防误发              | 在调用 Wrangler 前拒绝本地 DB，未发上传请求；`/tmp/mademe-local-config-guard.log`                                                                                                                                        |
| `npm run test:smoke`        | 隔离本地 Worker HTTP 冒烟通过；最新 `/tmp/mademe-actions-smoke.log`                                                                                                                                                      |
| `npm run test:worker`       | 初次在旧PNG断言失败；测试按当前WebP契约更新后完整流程通过，`/tmp/mademe-actions-worker.log`，未删减后续检查                                                                                                              |
| 未修改 main 对照            | 独立 worktree `/workspace/mademe-production-baseline`，精确同基线、单独 build/隔离 Worker，在同断言复现相同失败；`/tmp/mademe-baseline-{build,worker}.log`。证实原失败非此次配置引入；之后仅修正旧测试，媒体产品代码不改 |
| 生产 profile build          | 通过；`/tmp/mademe-actions-production-build.log`                                                                                                                                                                         |
| `npm run verify:production` | 真正执行 Wrangler `versions upload --strict --dry-run`，通过，未上传/发布；`/tmp/mademe-actions-dryrun.log`                                                                                                              |
| 实际生产发布/线上验收       | **未执行**，部署授权通道待确认；不以 dry-run 代替                                                                                                                                                                        |

dry-run 最初因宿主 Wrangler 全局配置目录不存在失败；仅 dry-run 改用本次临时 XDG 配置目录后通过，不修改宿主目录，不改变实际发布的认证来源。检查脚本模式参数的命令在调用 Wrangler 前拒绝了 `--publish --dry-run`，避免 npm 追加参数造成误发布。测试构建产物和缓存由 Git 忽略；主工作区保留此次源码/说明改动，基线对照工作区无 tracked 改动。

实际生成的生产配置保留：`name=author-studio`、`keep_vars=true`、`main=entry.mjs`、`no_bundle=true`、`assets.directory=../client`、真实 DB/R2。未出现 vars 值、routes、workers_dev 或 preview_urls。根配置的默认占位并未变成远程目标。

## 权限结论与未完成项

官方 Workers Builds [文档](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)明确支持自有/已有用户 token；当前用户看到的连接表单只有宽权限自动创建，本轮未创建或连接，也不先创建再缩权。

旧 `Workers Scripts Edit/Write` 是账户级，可限定目标账户但不等于单 Worker 隔离。较新的官方 [Workers 角色说明](https://developers.cloudflare.com/workers/authorization/workers/)支持为指定已存在 Worker 的 token 授予 `Editor`；上传/部署 API 接受 `Individual Workers Editor`。它还明确绑定现有 D1/R2 不需独立资源写权限，版本发布不变更路由时不需 Zone Routes Write。Custom Domains 对 per-Worker roles 的限制、此账户是否提供新角色/自有 token 入口及完整首次发布均未实测，不能承诺已可用。

用户最终批准仅 author-studio 的 Individual Workers Editor 专用 token，当前工作流已接入 GitHub Actions 来源。此执行器不配置或读取 secret；用户最终确定名称 CLOUDFLARE_API_TOKEN_FOR_DEPLOY 并确认已保存；CI 使用这个 secret 映射为 Wrangler 所需的 CLOUDFLARE_API_TOKEN 环境变量。名称列表元数据已由父任务独立确认，不要求用户改名或重建。不自动回退到其它 token；CI 只显式传这一项给复用工作流，不使用 secrets inherit。首次真实发布尚未执行；若最小权限不足，先报告准确API失败，不扩大授权。

避免复发：生产环境在 build 时选择；只使用生成的配置；首次发布前让审核后的补丁先到 main；不从运行时 secret 借用部署权限；不为避免失败而扩大 token 范围。后续真实发布需记录实际 SHA、上传 UUID、deployment ID、终态及非破坏性线上验证，异常先查结果再决定重试。

## Actions 发布门槛与普通 CI 的差异

原 CI 新增 deploy job，needs:test 明确依赖实际必要检查成功；main push/手动事件才调用同提交的本地可复用部署工作流。不使用 workflow_run 或其它工作流产物，不向 PR/fork 发布 job 提供生产 secret；手动入口不能自填部署 SHA，main/ref/仓库在调用方、被调用 job 与脚本检查。原 CI 的 checkout/setup-node 一并固定官方 SHA并禁用 checkout 凭据持久化。只在最后发布步骤注入 token，GitHub 默认 token 仅 contents read，用于核对排队构建是否仍为当前 main。main 核对与 CF 切流量不是原子事务，极短窗口内出现新 main 时可能先完成本次已验证发布，再由后续构建更新；concurrency 不保护其它系统手工部署。

普通 CI 只有 Vitest、集成协议、check；新发布流程在此基础上增加默认 build、smoke、完整 worker、生产 build、dry-run，所有失败均阻止发布。原main的worker用例首先在旧PNG文件名断言失败，后面还沿用原PNG字节/长度作为Range基准。测试改为核对现有WebP契约，并保留全部范围/私有/MOV及其余流程后，完整真实Worker/D1/R2已通过。不是忽略断言或修改产品行为；不以普通CI成功代替发布门槛成功。

使用当前已安装 YAML 解析器检查两份工作流语法/唯一键、needs:test、仅main发布条件、contents read、固定Action完整SHA、禁用凭据持久化、两级main非取消并发组、无continue-on-error、secret只在发布步骤及显式传递、所有检查顺序；通过，记录 /tmp/mademe-actions-workflow-check.log。未安装 actionlint，初版head dbf64cb的分支push/PR CI已在GitHub通过，deploy均skipped；ready后自然触发的AI审核工作流成功，正文建议修改后合并，细节意见已经独立只读复核，未据此扩展无关修改。此后的secret引用更新须对新head另查实际CI/审核；首次生产发布仍未运行。官方 action 的完整 SHA 经各自官方 git tag 与 release 页面核对。

## Secret 最终名称校正

按用户最终明确的名称，调用方只引用 `secrets.CLOUDFLARE_API_TOKEN_FOR_DEPLOY`，显式传给复用工作流的 `cloudflare_deploy_token`，最终映射到运行环境 `CLOUDFLARE_API_TOKEN`。不读取或输出值，不回退任何旧token。此更新不改业务、绑定、部署门槛或token权限，Secret名称元数据已核验，合并仍须对新head核对CI与审核。
