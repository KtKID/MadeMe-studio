# 2026-10-31：首页刊物布局与封面比例合并整合

## 原因

PR #4（首页三篇主次 + 四列网格，新组件 `HomeFeaturedPosts.tsx`）基于封面比例功能（PR #5）合入 main 之前的代码。合并 origin/main 后：

- `PublicFeed.tsx` 文本冲突：#5 把卡片封面换成 `CoverFrame` + `coverSettings`，#4 把默认 `paper` 布局改交给 `HomeFeaturedPosts`。
- `HomeFeaturedPosts` 仍用裸 `<img>` + 固定占位比例（16:9 / 2.8 / 主篇拉伸），默认首页会忽略文章设置的封面比例、展示方式和焦点，与文章页、编辑器不一致。
- `tests/e2e/cover.spec.ts` 断言首页标题字号最多 2 种（旧布局：featured + 普通）；新刊物布局有主篇 / 次篇 / 网格 3 种，断言失败（封面几何断言本身通过）。

## 改动

- `PublicFeed.tsx`：保留 #4 的分支结构（`paper` → `HomeFeaturedPosts`），其余布局的卡片使用 #5 的 `CoverFrame` 与 `has-cover`。
- `HomeFeaturedPosts.tsx`：有封面时改用 `CoverFrame`（传 `post.coverSettings`，保留 #4 的 eager/lazy 策略），容器加 `has-cover`；无封面仍用抽象占位图。
- `home-featured-posts.css`：文件末尾新增 `.has-cover` 规则，取消占位框固定比例、最小高度与主篇拉伸，封面高度由文章封面比例决定；圆角沿用 #4 的 6px。
- `tests/e2e/cover.spec.ts`：字号种类上限 2 → 3，并注明原因。
- `src/components/content/README.md`：更新封面说明。

## 验证

`npx vitest run`、`npm run test:integrations`、`npm run check`、`npm run build` 全部通过；`npm run test:e2e:home`（2 项）与 `npm run test:e2e:cover`（5 项，含 1440/390 首页封面几何）在本地 Chrome 下通过；人工查看首页截图。

## 经验

两个 PR 同时改同一展示组件时，合并不只看文本冲突：新增的组件（这里是 `HomeFeaturedPosts`）会绕开另一 PR 的共享展示组件，需要跑双方的 e2e 才能发现。

## 待人工确认

真实封面比例不一时，重点区主篇与右侧两篇高度不再严格对齐（例如 1:1 主篇较高时，右侧两篇之间留白）。这是“按文章自己的比例展示”的直接结果；若希望重点区统一裁切成固定版框，需要另行设计。
