# 作品封面比例与展示设置 · 实施方案与实施记录

> 本文保留历史分析和阶段实施记录。当前封面规范及与已确认设计的差异见 [COVERS.md](COVERS.md)，模块入口见 [MODULES.md](MODULES.md)；下文早期“现状”不表示当前源码状态。

> Phase 1 分析稿 + Phase 2 实施记录。§7 的问题已由 KID 确认（见 §7），与之冲突的早期建议（主题色补底、方图 560px 上限）以 §7 为准。

来源：KtKID/agent-mailbox#2（KID 已确认的产品方案）。分支 `feat/cover-aspect-ratio`，基于 origin/main `cf1887f`。

## 0. 基线（2026-10-30，Node v24.22.1）

- `npm ci` 成功（必须用 Node ≥24：`export PATH=/workspace/tools/node-v24.22.1-linux-x64/bin:$PATH`；系统 Node 20 下 19 个 jsdom 测试文件因 undici 启动失败）。
- `npx vitest run`：**92 文件 / 823 项全部通过**。
- `npm run test:integrations`：19/19 通过。
- `npm run check`：260 文件 0 error / 0 warning / 5 既有 hint。
- Playwright E2E（`npm run test:e2e`）需要运行中的 dev 服务与测试作者身份，本阶段未执行。

## 1. 现状：封面在哪里

| 层         | 位置                                                                                                                                                                                                                | 现状                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 数据契约   | `src/shared/contracts.ts` `editablePostSchema.coverImage`（`/api/files/<id>` 或 https，可空）                                                                                                                       | 只有 URL，无任何展示参数                                                      |
| 存储       | D1 `posts.document_json`（草稿）/ `published_json`（发布快照）/ `revisions.document_json`，整篇 Post JSON                                                                                                           | **加字段无需 SQL 迁移**                                                       |
| 列表摘要   | `postSummarySchema = postSchema.pick({... coverImage ...})`，`page-data.ts` 与 `repository.ts` 用它 `parse`                                                                                                         | zod 非 strict 会**静默剥离**未 pick 的新字段，必须同步加入                    |
| 发布差异   | `modules/publication-status/server.ts` `publishedContent()` 比较 coverImage                                                                                                                                         | 新字段必须参与比较，且缺省值要归一，避免旧文章被误标“有未发布修改”            |
| 编辑器     | `Editor.tsx` 955–972：`.editor-cover` 内裸 `<img>` + “移除封面”；无封面时“添加封面”→ 媒体库 `onCover`                                                                                                               | CSS `global.css` 1407：高 230px（移动 2735：160px），`object-fit: cover` 居中 |
| 发布面板   | `Editor.tsx` 1346–1420 `publishOpen` Modal：仅“谁可以阅读”+密码                                                                                                                                                     | 无封面区；`publish()` 先保存草稿再发布                                        |
| 首页卡片   | `PublicFeed.tsx` 77：`.article-card-visual` 固定 `aspect-ratio: 1.55` + `object-fit: cover`，hover `scale(1.04)`；4 种布局 `data-layout` = paper/ink/mono/garden（ink 为 180px 左图列表；paper 首篇 featured 横排） | 统一二次裁切                                                                  |
| 文章页     | `src/pages/p/[slug].astro` 91：`.reading-cover img` 宽 100%、`max-height: 500px; object-fit: cover`                                                                                                                 | 方图会被截；无宽度上限                                                        |
| 工作台列表 | `Dashboard.tsx` 278 `.post-thumb`（小方缩略图，cover 裁切）                                                                                                                                                         | 次要展示面                                                                    |
| 本地导出   | `modules/local-export` 只带 `coverUrl`                                                                                                                                                                              | 不涉及展示设置                                                                |
| 外部发布器 | `integrations/*` 共享 `src/shared/contracts.ts`；`/tmp/pk/mademe-publisher` 是 **Obsidian 插件 0.1.0 的旧构建产物**（main.js 内打包了 postSchema）                                                                  | 只建草稿、不写封面；见 §6 风险                                                |
| 媒体库裁剪 | `components/media/MediaLibrary.tsx` `CropImage` + `crop-state.ts` `cropGeometry(w,h,ratio,zoom,x%,y%)`；滑杆式缩放/水平/垂直，canvas 预览，“保存为新图片”                                                           | 可复用几何语义（x/y 为剩余空间百分比，zoom 1–3）                              |
| 生图       | `server/ai/images.ts`：openai/openrouter `size` 与 siliconflow `image_size` 固定 `AI_IMAGE_DEFAULTS.size = "1024x1024"`；gemini/cloudflare 不传尺寸；`imageInputSchema` 只有 prompt/postId/providerId               | UI 无比例选项                                                                 |
| 测试       | vitest（`tests/**/*.test.ts(x)`，jsdom + RTL 位于 `tests/ui/`），Playwright `tests/e2e/*.spec.ts`（`@author` 需测试作者），`tests/fixtures/valid-image.png`                                                         |                                                                               |
| UI 组件    | `components/shared/ui.tsx`：`Modal`（支持 modal-stack 嵌套）、`Notice`、`Busy`；`modules/article-types/TypeDropdown.tsx` 主题化下拉；CSS 变量 `--tint/--tint-strong/--accent/--soft/--line` 随主题切换              |                                                                               |

## 2. 数据设计：统一封面设置协议

新模块 `src/modules/cover/`（与 article-types、publication-status 同一组织方式）。

```ts
// src/modules/cover/contracts.ts
export const COVER_ASPECTS = ["original", "1:1", "4:3", "16:9"] as const;
export const coverSettingsSchema = z
  .object({
    aspect: z.enum(COVER_ASPECTS), // 比例预设
    fit: z.enum(["contain", "cover"]), // 完整显示(白色补底，KID 确认) / 铺满裁切
    focusX: z.number().min(0).max(100), // 裁切位置：剩余空间百分比，与 cropGeometry 语义一致
    focusY: z.number().min(0).max(100),
    zoom: z.number().min(1).max(3), // 仅 fit=cover 生效
  })
  .strict();
export const DEFAULT_COVER_SETTINGS = {
  aspect: "original",
  fit: "contain",
  focusX: 50,
  focusY: 50,
  zoom: 1,
};
export function normalizeCoverSettings(
  v?: Partial<CoverSettings>,
): CoverSettings; // 缺省/非法 → 默认
```

- `editablePostSchema` 增加 `coverSettings: coverSettingsSchema.optional()`；`postSummarySchema` pick 中加入；create/patch 自动继承（partial）。
- 持久化：随 Post JSON 进入 `document_json` / `published_json` / revisions，**不新增列、不写 drizzle 迁移**；保存草稿、重载、发布快照、版本恢复天然一致。
- 只存参数，不生成新图：原图不动，切换比例无需重新生图。
- `aspect="original"` 时 fit 无意义（不裁、不补），UI 禁用展示方式。
- 更换封面图：保留 aspect/fit，重置 focus/zoom；移除封面：同时清除 coverSettings。
- `publishedContent()` 用 `normalizeCoverSettings` 后比较 → 旧文章（无字段）与默认值等价，不会误报待发布。

## 3. 渲染：一个几何函数 + 一个组件，三处共用

- `src/modules/cover/geometry.ts`（纯函数，可单测）：`coverFrameStyle(settings)` → 容器 `aspect-ratio`；`coverImageStyle(settings)` → `object-fit`、`object-position: X% Y%`、`transform: scale(zoom)`、`transform-origin: X% Y%`。全部是相对单位，因此任意容器尺寸（桌面/窄屏/卡片/编辑器）可见区域一致；并提供 `visibleRegion(naturalW, naturalH, settings)`，用单测证明与 `cropGeometry` 一致。
- `CoverFrame.tsx`：`<figure class="cover-frame" data-aspect data-fit>`；contain 时背景白色 `#ffffff`（KID 确认；原稿为主题色 --tint，已作废），图片 `object-fit: contain` 不拉伸；original 时 `<img>` 宽 100% 高 auto。可被 Astro 文章页直接 SSR（不需要 hydrate）。
- `CoverAdjuster.tsx`：比例分段按钮 + 展示方式（完整显示/铺满裁切）+ 拖动定位（pointer 事件，键盘方向键可调）+ 缩放滑杆 + **实时预览**：外层显示整张原图半透明，内层高亮框标出保留区域（被裁掉部分可见、变暗），下方 1–2 个尺寸的实际效果预览（卡片/文章页）。复用 `Modal`、`.button`、`form-grid`、现有滑杆样式与 `TypeDropdown` 风格，不引入新依赖。
- `styles.css`：`.cover-frame` 系列，独立文件（如 `modules/article-types/styles.css`）。

## 4. 文件级改动

1. `src/modules/cover/{contracts,geometry}.ts`、`CoverFrame.tsx`、`CoverAdjuster.tsx`、`styles.css`、`README.md`（新）。
2. `src/shared/contracts.ts`：editablePostSchema 加 `coverSettings`；postSummarySchema pick。
3. `src/server/content/service.ts`：create 默认不写（保持 optional）；update 时 coverImage 变化而未同时给 coverSettings → 重置 focus/zoom（或交给前端，二选一，倾向前端+服务端 normalize）。
4. `src/modules/publication-status/server.ts`：publishedContent 加入归一后的 coverSettings。
5. `src/components/editor/Editor.tsx`：
   - 新 state `coverSettings`，`fields()` 带上，载入/重载/恢复时 `setCoverSettings(p.coverSettings)`（582、797 行附近）。
   - `.editor-cover` 改用 `CoverFrame`；悬浮工具条“调整 / 更换 / 移除封面”；“调整”打开 `CoverAdjuster` 弹窗（确定写入并 markDirty，取消丢弃）。
   - 发布弹窗加“封面”区：缩略图 + 选图（嵌套媒体库 Modal）→ 比例 → 展示方式 → 实时预览；修改即 markDirty，`publish()` 先保存再发布，保证持久化。
6. `src/components/content/PublicFeed.tsx` + `global.css`：`.article-card-visual` 去掉固定 1.55，改由 CoverFrame 决定高度；`align-items: start`，文字区保持一致排版；hover 缩放移到外层避免与 zoom 冲突；逐个核对 paper(featured)/ink(180px 列)/mono/garden。无封面的抽象封面保持原比例。
7. `src/pages/p/[slug].astro` + CSS：`.reading-cover` 用 CoverFrame，去掉 `max-height:500px; object-fit:cover`；最大显示 1024×1024（宽、高都不超过 1024，KID 确认；原稿 560px 建议已作废），小容器等比缩小、居中。
8. `src/components/content/Dashboard.tsx`：缩略图沿用同一设置在方形小框内渲染（不另行裁切规则）。
9. `src/components/media/MediaLibrary.tsx`：`onCover` 不变；可选抽出 `cropGeometry` 共享语义。
10. 文档：`src/components/editor/README.md`、`content/README.md`、`docs/INTERACTION-COVERAGE.md`、`docs/VERIFICATION.md` 按仓库惯例记录实测结果。
11. （若纳入 v1）生图比例：`imageInputSchema` 加 `aspect`；`AI_IMAGE_DEFAULTS` 按 provider 映射尺寸（openai gpt-image：1024x1024/1536x1024；siliconflow 支持的 image_size 列表；gemini/cloudflare 不支持则忽略并在 UI 标注“该服务商固定方形”）；媒体库生图弹窗加比例下拉。

## 5. 测试计划（先红后绿）

**单元（vitest）**

- `tests/cover-contracts.test.ts`：schema 边界、normalize 缺省/越界、旧 Post 无字段可解析。
- `tests/cover-geometry.test.ts`：四种比例 × 两种方式的样式输出；`visibleRegion` 与 `cropGeometry` 一致；contain 不裁、不变形（缩放比 x=y）。
- `tests/backend/posts.test.ts` 扩展：保存→读取→发布→published 快照→重新发布保留 coverSettings；summary 不剥离；旧文章 `hasUnpublishedChanges=false`；仅改 coverSettings 时为 true；版本恢复带回设置。
  **组件（tests/ui，jsdom+RTL）**
- `cover-adjuster.test.tsx`：选比例、切换方式、拖动/键盘调位置、缩放、取消不改动、确认 markDirty；original 时禁用展示方式。
- `editor-cover.test.tsx`：“调整”入口、发布面板封面区实时预览、移除封面清设置、选图后重置 focus/zoom。
- PublicFeed / 文章页 SSR 渲染：各比例输出 data-aspect 与样式。
  **浏览器 E2E（Playwright，`@author`）**
- 测试图：canvas 生成带四边彩色边框、四角标记与中心/角落文字的 1600×900、900×1600、1000×1000 图。
- 覆盖 original/1:1/4:3/16:9 × contain/cover，视口 1440 与 390：首页、编辑器、文章页截图 + 像素断言（contain 四边标记均可见、无拉伸；cover 拖动后指定角标进入可见区）。
- 流程：调整→取消、调整→保存草稿→刷新→仍在→发布→文章页/首页一致→再改→再发布。
  **真实生图 E2E**：单独记录（需真实 key），结果与 mock 分开写入 `reports/`，不得互相冒充。

## 6. 兼容与风险

- 旧文章无 coverSettings：渲染层按 `normalize` 默认处理；**默认值决定旧文章外观是否变化**（见问题 1）。
- 发布快照：旧 `published_json` 无字段，首页/文章页按默认渲染；无需重建（站点是 Astro SSR + Workers 动态渲染，不是静态产物）。
- 旧版集成客户端：`postMutationResponseSchema` 对完整 Post 使用 `.strict()`。若某 token 带 `posts:read`，旧构建（如 `/tmp/pk/mademe-publisher`）收到含 coverSettings 的响应会解析失败；只写 token 只拿回执不受影响。需随版本重新打包 Obsidian/Chrome/agent-publisher。
- `/tmp/pk/mademe-publisher` 与本功能无直接关系（不是静态站点发布器，只是插件构建产物），不需修改。

## 7. KID 的确认（Phase 2 依据）

> 原话：“封面最大1024*1024，这就是最大高度和宽度，被裁切的图用白色底补到对应比例。生图先不管，小缩略图也是一样，就是当前封面等比例缩小”

- 最大显示尺寸 1024×1024：宽和高都不超过 1024，小容器等比缩小；小图不放大。常量 `COVER_MAX_SIZE`。
- 补边颜色：**白色**（不用主题色）。常量 `COVER_FILL = "#ffffff"`。
- 生图比例：本期不做，不改 `server/ai/images.ts`。
- 工作台缩略图、ink 列表等小展示面：同一封面、同一设置，等比缩小，不另行裁切。
- 新旧文章默认：原图比例 + 完整显示，集中在 `DEFAULT_COVER_SETTINGS` 一个常量，后续可改。

原问题列表（已回答）：

1. 旧文章默认：按新规则“原图比例 + 完整显示”（首页卡片高度会变化、编辑器不再裁成横条），还是迁移为接近现状的“16:9 + 铺满裁切居中”保持外观不变？新文章默认是否也用“原图 + 完整显示”？
2. “原图比例”遇到很高的竖图（如 9:16 流程图）时，首页卡片是否需要最高高度上限（超出则按完整显示+主题色补底到 3:4）？
3. 生图时选择比例是否纳入 v1？（方案书写了问题但第一版列表未列；我倾向 v1 不做，单独跟进，以免受各服务商尺寸支持差异拖慢。）
4. 工作台文章列表的小缩略图是否也遵循同一设置（建议是），以及 ink 布局的 180px 左图是否允许不同高度。

## 8. Phase 2 实施记录

提交（本地分支 `feat/cover-aspect-ratio`，未推送、未开 PR）：

1. `test(cover)`：先写失败用例（协议/几何、后端持久化与发布状态、调整组件、展示面 SSR/CSS、编辑器与发布面板）。确认因模块不存在而失败。
2. `feat(cover)` 协议：`src/modules/cover/{contracts,geometry}.ts`；`editablePostSchema.coverSettings`（optional）；`postSummarySchema` pick 加入 `coverSettings`；`publishedContent()` 比较归一后的设置（旧文章无字段 = 默认，不误报）；服务端更换封面图且未带设置时重置位置/缩放。
3. `feat(cover)` 渲染与入口：`CoverFrame`（首页卡片/文章页/编辑器/工作台缩略图共用，缩略图用容器查询单位等比缩小）、`CoverAdjuster`（比例、展示方式、拖动/方向键、缩放与位置滑杆、实时预览）、编辑器“调整/更换/移除封面”、发布面板“封面”区；去掉首页固定 1.55 比例、文章页 500px 截断、编辑器 230px 横条。
4. `test(cover)` 浏览器 E2E：`tests/e2e/cover.spec.ts` + `npm run test:e2e:cover`（一次性作者 Worker/D1/R2）。`local-worker-runner` 增加可选 `suiteTimeout`（默认值不变）。

实现要点：

- 裁切几何与媒体库 `cropGeometry` 一致（`object-fit: cover` + `object-position X% Y%` + 同点 `transform-origin` 的 `scale(zoom)`），有单测证明。
- 不生成新图，只存参数；切换比例不需要重新生图。
- 编辑器每次保存都会带上 `coverSettings`（无封面时为默认值）。

## 9. 测试结果（2026-10-30，Node v24.22.1）

| 项目                                     | 基线（cf1887f）              | 实施后                                                   |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `npx vitest run`                         | 92 文件 / 823 项通过         | 97 文件 / 858 项通过（新增 35）                          |
| `npm run check`                          | 0 error / 0 warning / 5 hint | 0 error / 0 warning / 5 hint（hint 均为既有）            |
| `npm run test:integrations`              | 19/19                        | 19/19                                                    |
| Playwright `cover.spec.ts`（模拟测试图） | —                            | 5/5 通过                                                 |
| 真实生图 E2E                             | —                            | **未执行**（本期不做生图比例，也未调用任何真实生图服务） |

浏览器 E2E 为**模拟数据**：Canvas 生成的边缘标记图经真实上传接口存入一次性 R2，页面为真实 Worker SSR + 真实 BlockNote 编辑器，Chromium 为 `/opt/ungoogled-chromium/chrome`。像素断言覆盖原图/1:1/4:3/16:9 × 完整显示/铺满裁切（含 2 倍缩放）、1440 与 390 宽度、首页/文章页/编辑器/工作台缩略图，以及调整→取消→应用→保存→重载→发布面板改比例→发布→改草稿（线上不变）→重新发布。截图在 `/workspace/cover-shots/`（逐个封面框截图在 `frames/`）。

## 10. 未做与风险

- 生图比例选择：按 KID 决定本期不做。
- 旧版集成客户端兼容：已修复，见 §11。旧包不升级也能用；新包已在本地重建，尚未发布。
- 旧文章外观会变化：首页卡片按原图比例显示，高度可能各不相同；如需保持旧观感，只改 `DEFAULT_COVER_SETTINGS` 即可。
- 窄屏编辑器标题输入在超长无空格标题时会横向截断，为既有行为，与本功能无关。

## 11. 集成客户端兼容修复

根因（已用真实旧包验证）：集成客户端用 `postMutationResponseSchema = {post: union([postSchema.strict(), receipt.strict()])}.strict()` 解析写接口响应。Token 带 `posts:read` 时服务端返回完整 Post，任何新增字段都会触发 `unrecognized_keys`，两个联合分支都失败，于是报 "Unexpected API response"。此时请求在服务端已成功，用户重试会产生重复草稿或重复操作。

- 用 origin/main 的 `integrations/shared/client.ts` 对含 `coverSettings` 的载荷调用 `publishPost`：报错 "Unexpected API response…"，不含 `coverSettings` 时正常。
- `/tmp/pk/mademe-publisher/main.js`（0.1.0 旧包，内含 `union([Gt.strict(),Wb])`）**在 main 上已经失败**：还不认识 `hasUnpublishedChanges`、`publishedVisibility`（cf1887f 新增）和 `categoryId`。`coverSettings` 只是又多了一个触发字段。

修复：

1. 读取协议容忍新增字段：`postReadSchema`（未知字段剥离；`blocks` 按 unknown 读取；`coverSettingsReadSchema` 剥离多余键），`postMutationResponseSchema` 外层也不再 strict。回执分支仍然 strict，畸形或混入正文的回执照样拒绝。服务端输入（create/patch/publish）保持 strict。
2. 服务端向后兼容：Token 请求如果没有在 `Accept` 里声明 `mademe-post-schema=2`，完整 Post 只返回 `LEGACY_POST_KEYS`（0.1.0 字段）。覆盖写接口响应、GET 单篇和 GET 列表。站内作者会话不变；只裁剪响应，不改存储。
   - 选 Accept 媒体类型参数而不是自定义头：Accept 是 CORS 安全头，新客户端连旧服务端不会被预检拦截，也不用改 `Access-Control-Allow-Headers`。
3. 新客户端发送 `POST_SCHEMA_ACCEPT`。集成只建草稿和发布，不会读后回写，所以不存在丢失 `coverSettings` 的路径。
