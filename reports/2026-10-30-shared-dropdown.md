# 全站原生 select 替换为共享同主题下拉

## 现象
服务商下拉改版后，设置（正文字体、提示词动作）、编辑器 AI 对话框与发布弹窗、媒体库、Obsidian 保存弹窗仍是原生 `select`，展开为系统灰蓝菜单，与站点暖黄主题和文章类型下拉不一致。

## 根因
`TypeDropdown` 位于文章类型模块内且不支持禁用选项，其它入口无法直接复用；原生 `option disabled`（未配置的模型/图像服务商、未配置 SESSION_SECRET 的密码发布）需要等价语义。

## 修复内容（文件）
- `src/components/shared/Dropdown.tsx`、`dropdown.css`：由 `TypeDropdown` 迁移泛化。新增选项 `disabled`（`aria-disabled`、不可点击、键盘跳过、打开时落在可用项）与触发器 `className`；类名改为 `ui-dropdown-*`。
- `src/modules/article-types/TypeDropdown.tsx`：改为共享组件再导出；`type-dropdown.css` 只保留类型筛选尺寸。
- `src/components/settings/SettingsPanel.tsx`、`model-options.ts`：服务商、正文字体、提示词动作；新增 `fontOptions`、`promptActionOptions`（来自 `aiActionSchema`）。
- `src/components/editor/Editor.tsx`：AI“想怎么处理”“模型”“提示词”，发布“谁可以阅读”（密码项未配置时禁用）。
- `src/components/media/MediaLibrary.tsx`、`src/styles/global.css`：媒体类型筛选（`.media-tools > .media-filter` 沿用原尺寸）、裁剪比例、图像服务商（未配置项禁用）。
- `src/modules/obsidian-local/SaveButton.tsx`：保存预设。
- 测试：新增 `tests/ui/dropdown.test.tsx`；更新 settings/editor/media/obsidian 真实 DOM 用例改为点击选项，新增编辑器 AI 对话框与媒体生成/裁剪用例；`tests/e2e/settings-regressions.spec.ts` 改为点击字体选项。

值、顺序、文案与 onChange 副作用（如切换 AI 动作重置提示词、选择预设重置目录与冲突状态）保持不变。模型 ID 的 `datalist` 是自由输入建议，不是 select，保持原生。

## 验证方式与结果
- `npm run check`：0 errors / 0 warnings / 5 既有 hints。
- `npx vitest run`：91 文件、811 测试全部通过。
- 本地开发实例无头 Chromium 截图各下拉展开状态（交付说明列出路径）。
- `tests/e2e/settings-regressions.spec.ts` 在本地 dev 实例运行时于“主题与字体”切换后等待“深色”按钮超时（字体步骤之前，早于本次改动涉及的控件），未将其记为通过。

## 如何避免再次踩坑
新增枚举/单选一律使用 `src/components/shared/Dropdown.tsx`；需要“可见但不可选”时用选项 `disabled`，不要回退原生 select。测试用 `getByRole("combobox")` + 点击 `option`，不要 `fireEvent.change`/`selectOption`。
