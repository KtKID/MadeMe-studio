# 架构审查验证汇总（2026-10-31）

本次报告分析公开仓库提交 `67f02f06ac7ebc4400e47a54b315018120ac3588` 的源码；报告 PR 的父提交为 `09dbd849aad58fc34b93126baeb2832ead4f171a`。两者之间的变化在后续巡检中独立复核。

## 执行范围与结果

| 检查 | 结果 | 结论范围 |
|---|---|---|
| backend、unit、配置与阅读规则 | 40 文件、360 项通过 | 支撑已有身份、权限、快照、CAS、协议与阅读断言 |
| Studio loader / 身份生命周期 / 初始资源 | 5 文件、20 项通过 | 支撑已有工作台数据与身份边界断言 |
| 媒体配置一致性反例 | 预期 20；Studio SSR=25、Media SSR=25、HTTP=20 | B3 确认 |
| 邮件链接反例 | 保存和发布成功；阅读 HTML 为普通文字 | B4 确认 |
| 资源错误日志反例 | mediaError 有值；logCaught 调用为 0 | B5 确认 |
| package 清单暂存源码阶段 | 1 个检查通过，3 个测试文件加载失败 | B2：缺少 config/limits.ts |
| Drizzle 继续生成并应用迁移 | 重复添加 display_name；SQLite 报 duplicate column name | B1 确认 |
| AST 依赖扫描 | 143 文件、425 条内部边，其中 runtime 368、type 57；runtime SCC 1 组 | 初始报告的依赖范围 |

使用本地已有运行环境：Node 24.22.2、Vitest 4.1.12、drizzle-kit 0.31.10；依赖锁与审查源码一致。容器断网，源码挂载只读，写入使用一次性临时目录；数据库为内存 SQLite，R2 使用现有测试适配器。

原始执行日志、逐文件指纹与完整机器依赖图在本地保存。公开文件提供架构结论、可定位源码与复现步骤；此处的通过计数对应既有断言，主动构造的反例单独列明。

## 独立复核方法

在该提交的隔离源码副本中，使用已有锁定依赖执行：

```sh
npx vitest run tests/backend tests/unit tests/config-runtime.test.tsx tests/reader-structure.test.tsx tests/reader-styles.test.tsx
npx vitest run tests/studio-loader.test.ts tests/studio-shell-lifecycle.test.ts tests/studio-initial-resources.test.tsx tests/studio-navigation.test.ts tests/studio-secret-lifecycle.test.tsx
node scripts/audit-imports.mjs .
```

最后一条使用报告 PR 新增的通用扫描器。传入原审查源码目录可复核原始统计；新增扫描器自身也参与当前源码的脚本枚举，文件总数随提交变化。

### B1 迁移继续生成

复制当前 `src/server/db/schema.ts`、Drizzle 配置与 `drizzle/` 到临时副本，运行 `npm run db:generate`；在内存 SQLite 顺序执行既有四条迁移，再执行新增 SQL。记录是否重复添加 `google_author_sessions.display_name`。此步骤在临时副本产生迁移文件。

### B2 集成打包闭包

按 `integrations/scripts/package.mjs:21-22` 的精确集合重建暂存源码：HEAD 中的 integrations 源码（排除 INSTALL.md 和 scripts/package.mjs），加 src/shared/contracts.ts。连接已有 node_modules 后执行暂存目录的 Node 集成测试。初始基线报缺少 `src/modules/config/limits.ts`；此处覆盖完整脚本第33行进入的阶段，后续ZIP阶段保持未触达。

### B3 媒体条数

使用现有 `fixtureEnv` 和真实 SQLite，把作者媒体 listLimit 保存为 20，插入 25 条媒体元数据。分别调用 loadStudioPageData、loadMediaPageData 和 GET /api/media，独立断言三个结果长度为 20。

### B4 邮件链接

使用 PostService 创建含 `mailto:writer@example.com` 行内链接的段落并公开发布，从已发布快照读取块，再使用 BlockReader 做静态渲染，断言对应 anchor 的 href 得到保留。

### B5 失败证据

对现有 fixtureEnv 的媒体查询注入合成数据库错误，调用 loadStudioPageData，独立断言公开错误字段与结构化 logCaught 调用。错误输入为合成数据。

后续修复按相同反例验证，并在新报告中记录实际源码提交与结果。
