# 2026-10-27：工作台侧边栏底部精简，账号移到左下角

## 需求

- 左下角“我的站点 / 看看发布后的样子”卡片不再需要：右上角已经有“访问站点”链接（`.topbar-site`，`href="/"`，`Studio.astro` 与 `StudioShell.tsx` 都有）。
- 去掉最底部的“写作，让想法有迹可循”和前面的圆点。
- 账号入口放到左下角，距离侧边栏底边 10px。

## 修改前的间距（Chromium 实测，1440×900）

| 项 | 值 |
|---|---|
| 侧边栏 padding | 32px 21px 18px（≤1200px 时左右 17px） |
| `.sidebar-bottom` | `margin-top: auto`，无 padding |
| “我的站点”卡片 / 账号卡片 | padding 12px 10px，高 60px，gap 10px；账号卡片 `margin-top: 8px` |
| 底部标语 | `margin-top: 18px`，高 13px，圆点与文字间距 7px |
| **账号卡片到侧边栏底边** | **49px**（18 + 13 + 18） |
| 账号卡片左右内缩 | 21px / 22px（≤1200px 时 17px / 18px） |

## 修改

- `Studio.astro`、`StudioShell.tsx`：删除站点卡片和底部标语。`.sidebar-bottom` 只在有账号入口（password / google 模式）时渲染，避免留下空容器。
- `global.css`：
  - 新增 `--sidebar-bottom-gap: 10px`，侧边栏 `padding-bottom` 使用该变量。
  - 删除不再使用的 `.site-link > svg`、`.author-link { margin-top }`、`.sidebar-note`。
  - `.status-dot` 编辑器仍在用，保留。
- 左右内缩保持侧边栏原有的 21px / 17px，与导航和“写新文章”按钮对齐，没有改成 10px。
- 修改后实测：账号卡片到底边 10px（1440 与 1100 宽度相同）。
- 响应式：≤960px 时侧边栏变为顶部横向导航，`.sidebar-bottom` 本来就是隐藏的，这次没有改动；顶部导航与“访问站点”正常。
- `src/layouts/README.md` 已同步。

## 验证

- `npm run check` 0 错误；vitest 72 文件 560 测试通过；integrations 19/19。
- `tests/ui/author-account.test.tsx` 新增 2 个用例：不再出现站点卡片和标语、右上角链接存在、非登录模式不渲染底部容器、CSS 变量为 10px。
- 线上：版本 d134848d（2026-10-27 22:06 UTC+8），`/studio` 未登录页底部只剩“作者登录 / 账号与退出”，不含站点卡片与标语，CSS 含 `--sidebar-bottom-gap:10px`；部署前后 `git diff wrangler.jsonc` 为空。
- 截图（本地 SSR 渲染 + Chromium）：`/workspace/mm-fix/sidebar/after-1440.png`、`after-390.png`；修改前为 `before-*.png`。

## 如何避免

- 布局间距这类样式常量用 CSS 自定义属性集中定义，不在多个选择器里写死数字。
- `Studio.astro` 与 `StudioShell.tsx` 是同一侧边栏的两份标记，改动必须同步，并由测试同时检查。
