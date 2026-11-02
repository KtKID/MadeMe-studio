# 文章访问量记录与工作台「数据」面板

> spec: 无，独立任务
> 创建: 2026-11-01

## ① 需求

### 功能方向

访客每次打开一篇公开文章，网站把这次访问完整记录下来（精确到毫秒的时间、来源 IP、国家、浏览器标识、来源页面、服务端耗时、响应状态码），数据保存在自己的数据库里、可随时导出���走。作者登录工作台后，在新增的「数据」入口里查看访客数与 IP 列表；访客在任何公开页面都看不到任何访问数字。

### 功能边界

- 做：
  - 记录公开文章页的访客访问事件（毫秒时间戳、明文 IP、国家代码、User-Agent、Referer、服务端渲染耗时毫秒、HTTP 状态码）
  - 记录到站点自己的数据库（与文章内容同库，可整体导出迁移）
  - 工作台左侧导航在「所有文章 / 媒体库 / 站点设置 / 连接与发布」之后新增「数据」入口（`/studio/data`），仅作者可见
  - 「数据」面板顶部为横向 tab，本期只有第一个「网站状态」；tab 栏预留扩展位
  - 「网站状态」显示访客数（按 IP 去重）与访问次数，以及按 IP 汇总的列表（IP、访问次数、最近访问时间、国家），每页 10 条、分页
  - 爬虫访问照常入库，但所有统计口径排除爬虫与非 200 响应
  - 全站只有这一处展示访问数据
- 不做：
  - 公开文章页、首页等任何访客可见页面不显示阅读数（首轮曾在文章页展示，按需求撤销）
  - 不做按访客去重以外的识别（Cookie、指纹）、不做防刷
  - 不引入任何第三方统计脚本
  - 不统计 RSS、sitemap、API、静态资源等非文章页请求
  - 不做数据保留/清理策略；「网站状态」以外的其他 tab 本期不实现

### 不能破坏的不变量

- 文章页正常阅读不受影响：访问记录失败时页面照常返回，不报错给读者
- 作者登录状态下的浏览不产生访问记录
- 访问数据接口只对作者开放，访客请求一律 401
- 既有工作台四个面板的导航、离开保护、身份恢复行为不变；阅读、登录、发布、媒体功能不变

## ② 测试用例（先写，此刻失败）

### unit

- record_persists_all_fields：记录一条含明文 IP「203.0.113.7」、国家、UA、Referer、耗时、状态码的事件，直接查库验证八个字段逐一生效（含毫秒时间戳原值）→ 功能方向「完整��录」
- record_without_db_noop：无数据库绑定时记录不抛错直接返回 → 不变量「统计失败不影响」
- record_safely_swallows_db_failure：数据库写入抛错时安全记录只写日志、不向页面抛出 → 不变量「统计失败不影响」
- build_event_maps_headers_and_cf：从真实 Request/Response 构造事件：映射 cf-connecting-ip、user-agent、referer 头与 cf.country；无 cf 元数据时国家为 null → 功能方向「记录字段」
- count_excludes_bot_and_non200 / count_isolated_by_path / count_without_db_null / read_count_swallows_query_failure：按路径阅读数口径与容错（模块能力保留，公开页不再调用）→ 边界「排除爬虫与非 200」
- top_paths_ranks_and_windows：热门路径按窗口过滤降序 → 模块查询能力
- summary_counts_and_dedupes_ip：汇总只计访客 200，访客按 IP 去重（无 IP 归一组），支持时间窗口 → 功能方向「访客数」
- visitors_ordered_by_last_visit：访客列表按最近访问倒序，含每 IP 次数与国家 → 功能方向「IP 列表」
- visitors_pagination_bounds：pageSize/page 分页、页码 <1 归一、越界空页、无绑定零值 → 边界「每页 10 条分页」
- api_owner_reads_summary_and_visitors：作者请求 `/api/views/summary`、`/api/views/visitors` 返回 200 且结构符合共享协议 → 功能方向「工作台查看」
- api_rejects_guest_and_clamps_page：访客请求 401；`page=abc` 归一为 1 → 不变量「仅作者开放」
- ui_site_status_renders_stats_and_ip_table：DataStudio 渲染访客数、访问次数、IP 行（无 IP 显示「未知」）、tab 选中态、单页不显示分页 → 功能方向「网站状态」
- ui_pagination_requests_next_page：点击下一页携带 `page=2` 重新请求并渲染新页 → 边界「分页」
- ui_load_error_shows_notice：接口失败显示错误提示，不显示数字 → 不变量「失败不冒充数据」

### smoke

- record_read_roundtrip_on_real_sqlite：用真实 SQLite（执行全部迁移）播种一篇已发布文章，以文章公开路径记录一次访客访问，阅读数与热门排名立即可查 → 记录→查询完整调用链

### e2e

不需要，依据：面板接线复用既有 StudioShell 常驻面板机制（新增一个 link + 一个 pane），构造事件、落库、汇总、分页与鉴权已由 unit/真实 SQLite/API 覆盖，面板渲染与分页交互由 jsdom UI 测试覆盖；真实浏览器链路由既有 e2e 体系维护。

## ③ 技术实现

### 实现步骤

1. `drizzle/0005_page_view_events.sql` + `drizzle/meta/_journal.json` + `src/server/db/schema.ts`：新建 `page_view_events` 事件表（ts/path/ip/country/ua/referer/duration_ms/status）及 path+ts、ts 两个索引。
2. `src/server/page-views.ts`：`recordPageView`、`recordPageViewSafely`、`buildPageViewEvent`、`readPostViewCount`、`listTopPaths`；新增 `visitSummary`（访问次数 + 按 IP 分组去重的访客数，无 IP 归一组）与 `listVisitors`（按 IP 汇总、最近访问倒序、分页，页码 <1 归一）。统计口径统一：status = 200 且 UA 不含 bot/spider/crawler。
3. `src/middleware.ts`：请求起点计时；文章页对可计数访问设置 `locals.pageView`，中间件在 `next()` 后补齐状态码与耗时落库，仅 GET，失败只写日志。
4. `src/pages/p/[slug].astro`：公开文章且非作者访问时设置标记；**不读取、不展示**任何阅读数。
5. `src/server/api.ts`：新增 `GET /api/views/summary`、`GET /api/views/visitors?page=N`，`requireOwner` 鉴权，非法页码归一。
6. `src/shared/contracts.ts` + `src/components/shared/api-protocol.ts`：新增 `visitSummaryResponseSchema`、`visitorsResponseSchema` 并注册到客户端端点白名单（客户端 `api()` 拒绝未注册端点）。
7. `src/modules/navigation-performance/protocol.ts`：`Route` 枚举新增 `/studio/data`。
8. `src/components/studio/StudioShell.tsx`：导航新增「数据」（BarChart3 图标），panes 新增 `<DataStudio />`。
9. `src/components/studio/DataStudio.tsx`：面板组件——page-heading、横向 tab（本期仅「网站状态」）、两张统计卡（访客数 / 访问次数）、IP 汇总表、分页控件；激活时并行请求两个接口，过期响应丢弃，失败显示 Notice；接入 `useNavigationReady("/studio/data")`。
10. `src/pages/studio/data.astro`：复用 `StudioWorkspace` 的 SSR 深链入口。
11. `src/styles/global.css`：追加 `.data-tabs` / `.data-table` / `.data-pagination` 样式。

### 涉及文件

- drizzle/0005_page_view_events.sql、drizzle/meta/_journal.json、src/server/db/schema.ts: 事件表迁移与 schema 同步
- src/server/page-views.ts: 记录/阅读数/热门/汇总/访客分页/事件构造/安全写入
- src/middleware.ts: 计时 + 标记检查 + 落库接线
- src/pages/p/[slug].astro: 仅设置计数标记，不展示
- src/server/api.ts: `/api/views/*` 作者专属接口
- src/shared/contracts.ts、src/components/shared/api-protocol.ts: 响应协议与端点白名单
- src/modules/navigation-performance/protocol.ts: 路由枚举
- src/components/studio/StudioShell.tsx: 导航与面板接入
- src/components/studio/DataStudio.tsx: 「数据」面板（新）
- src/pages/studio/data.astro: 深链页（新）
- src/styles/global.css: 面板样式
- tests/backend/page-views.test.ts: 16 项（15 unit + 1 smoke）
- tests/ui/data-studio.test.tsx: 3 项 jsdom UI 测试（新）
- tests/backend/README.md、tests/ui/README.md、src/server/README.md、src/components/studio/README.md、src/modules/studio-navigation/README.md: 文档同步

### 过程修正记录

- 首次「红」实际是 vitest 缺失导致的启动错误（本机 volume 无 node_modules），`npm ci` 后按 TDD 语义确认：模块不存在时导入失败即为红，实现后转绿。
- `top_paths_ranks_and_windows` 首跑失败是测试预期错误：并列次数的排序预期写反；实现口径为 `views DESC, path ASC`，修正测试后通过。
- 自检发现部署流程不自动应用 D1 迁移，若生产库尚无表，文章页读取阅读数会 500；给读取侧补了 `pageview.read_failed` 兜底并加测试。
- **需求演进**：首轮在公开文章页展示「N 次阅读」，用户明确要求访客不可见、只在工作台展示；撤销页面展示，新增工作台「数据」面板。第二轮测试（汇总/访客/API/UI）先写后实现。
- 实现「数据」面板时发现客户端 `api()` 按端点白名单 + Zod 协议解析响应，未注册端点一律抛 INVALID_RESPONSE；据此补齐 contracts 与 api-protocol 注册。
- UI 测试两处选择器修正：「访问次数」同时出现在统计卡和表头，改用 `getAllByText`；分页按钮文本被图标拆分，改用 `getByRole("button", { name })`；分页用例初始 mock 需返回两页才会渲染分页栏。均为测试写法问题，实现未改。

## ④ 验证结果

### 测试输出

本次新增测试（`npx vitest run tests/backend/page-views.test.ts tests/ui/data-studio.test.tsx`）：

```
 ✓ tests/backend/page-views.test.ts (16 tests) 48ms
 ✓ tests/ui/data-studio.test.tsx (3 tests) 93ms
 Test Files  2 passed (2)
      Tests  19 passed (19)
```

全量回归（`npm test`）：

```
 Test Files  1 failed | 111 passed (112)
      Tests  16 failed | 971 passed (987)
```

类型检查（`npm run check`）：本次改动文件 0 错误；仅存错误全部位于任务开始前已存在的未跟踪审计证据文件 `reports/audit/evidence-*/`（与本次无关）。

### 不变量回归

- 全量 16 个失败集中在 `tests/ui/editor-conflicts.test.tsx`，失败原因为 jsdom 环境 `localStorage.clear is not a function`；首轮已用 `git stash -u` 在**不含本次改动的干净树**上复现同一失败，确认是既有环境问题，与本任务无关（修复超出边界，未顺手修改）。
- 其余 111 个测试文件全绿，覆盖工作台导航（`studio-navigation`、`studio-loader`）、登录、发布、阅读、媒体、设置等既有行为。
- 访客 401：`api_rejects_guest_and_clamps_page` 直接验证；公开页不再引用任何阅读数读取函数（`[slug].astro` 仅设标记）。
- 记录失败路径由 `recordPageViewSafely` 保证不抛出；无 DB 绑定时记录/查询均为无操作或零值（有专项测试）。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过（本次新增 19/19；既有失败经干净树复现确认为与本任务无关的既有问题）
- [x] 实现在边界内（公开页零展示；数据只在工作台「数据」面板）
- [x] 不变量未破坏

### 生产库迁移记录

2026-11-02 由本机 `wrangler login`（OAuth 登录，账号信息不入库）执行，真实输出摘录：

```
Migrations to be applied: 0005_page_view_events.sql
🚣 Executed 4 commands in 0.94ms
│ 0005_page_view_events.sql │ ✅ │
sqlite_master: table page_view_events, index idx_page_view_events_path_ts, index idx_page_view_events_ts
d1_migrations #5: 0005_page_view_events.sql  applied_at 2026-11-02 04:19:08
```

应用前 `migrations list` 确认待应用项仅 0005；0001–0004 登记时间保持 2026-10-27 原值，既有数据未改动。

### 部署前置（已完成）

部署脚本与 CI 不自动应用 D1 迁移，本次已手动执行（见上）；后续再有新迁移需重复：

```sh
npx wrangler d1 migrations apply author-studio --env production --remote
```
