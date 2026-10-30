# 设置页服务商下拉改用同主题控件

## 现象
设置 → AI 模型卡片中的“服务商”字段仍是原生 `select`，展开后显示操作系统灰蓝菜单，与文章类型下拉及站点暖黄主题不一致。

## 根因
`TypeDropdown` 只接入了首页、后台筛选和编辑器的文章类型入口；`SettingsPanel.tsx` 的服务商字段未迁移。

## 修复内容（文件）
- `src/components/settings/SettingsPanel.tsx`：服务商字段改用 `TypeDropdown`（combobox/listbox、键盘、外点关闭、选中勾选），值与 `provider(i, { kind })` 更新逻辑不变。
- `src/components/settings/model-options.ts`：新增 `providerOptions`，由 `providerLabels` 派生，顺序不变（OpenAI、OpenRouter、SiliconFlow、Cloudflare AI、Google Gemini）。
- `tests/ui/settings-clicks.test.tsx`：新增真实 DOM 用例：卡片内无原生 select、选项顺序、已选标记、键盘选择后关闭、dirty 状态及保存载荷 `kind`。

## 验证方式与结果
- `npm run check`：256 文件，0 errors / 0 warnings / 5 既有 hints。
- `npx vitest run`：全部通过（805 测试）。
- 本地开发实例（开发身份，回环地址）Chromium 无头截图：闭合、展开（活动项与已选勾选）、选择后焦点态。

## 如何避免再次踩坑
新增枚举选择优先复用 `TypeDropdown`，不要再引入原生 `select`；选项从单一展示名称来源派生，避免顺序或文案分叉。其它设置项（正文字体、提示词动作）以及媒体库、编辑器中的原生 select 未在本次范围内。
