# 共享下拉 PR 审核修复：重选当前值不触发 change、禁用变化时校正活动项

## 现象
PR #2 的 AI 审核指出两处与原生 `select` 语义不一致：
1. 重新点击/回车选择当前值也会调用 `onChange`。编辑器 AI 对话框里重选当前“想怎么处理”会作废 AI 会话、清空已生成（可能已手动编辑）的建议并重置提示词；重选当前模型或提示词也会清空建议。
2. 菜单打开时，若选项数量不变而某项禁用状态变化（例如服务商配置状态刷新），活动项不会重新校正，`aria-activedescendant` 可能停在已禁用项上。

## 根因
- `choose()` 无条件调用 `onChange`；原生 `select` 只在值真正变化时派发 `change`。
- 活动项同步 effect 只依赖 `[value, options.length]`，看不到选项值或禁用状态的变化。

## 修复内容（文件）
- `src/components/shared/Dropdown.tsx`：`choose()` 只在 `option.value !== value` 时调用 `onChange`（仍关闭菜单并归还焦点）；活动项同步 effect 改为依赖 `open`、`value` 与“选项值 + 禁用状态”签名，当前活动项仍存在且可用则保留，否则回到 `initialActive()`。
- 测试：`tests/ui/dropdown.test.tsx` 新增“重选当前值不触发 onChange”（点击与回车）、“数量不变但禁用变化时活动项移出禁用项”；`tests/ui/editor-clicks.test.tsx` 新增“重选当前动作/模型/提示词保留已编辑建议与提示词选择”；原键盘用例改为选择不同值，`tests/ui/type-dropdown.test.tsx` 同理。

组件接口、选项结构与各调用方 onChange 副作用均未改变。

## 验证方式与结果
- 新用例在去掉修复时失败、加上修复后通过。
- `npm run check`、`npx vitest run` 结果见交付说明。

## 如何避免再次踩坑
自定义表单控件要对齐原生语义：只有值变化才派发 change；依赖“选项是否变化”的 effect 不要只比较长度，应比较值与状态签名。
