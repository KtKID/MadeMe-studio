# 共享界面与协议适配

`ui.tsx` 提供服务端共享 Zod 类型的前端引用、同源 API 调用、错误分类、URL 校验、对话框、空状态和下载辅助函数。敏感凭据不写 localStorage。

`ProductCredit.tsx` 从统一发布配置读取产品版本，博客首页、文章页及两套后台布局共用静态署名 `Powered by MadeMe · v版本`。Astro 直接 SSR，不添加客户端水合；测试见 `tests/product-footer.test.tsx`。

## 边界与测试

- API 错误保留 HTTP 状态和错误码，409 交给编辑器显式处理。
- URL 只接受 HTTP(S) 或根相对路径；拒绝 JavaScript/data 等执行协议。
- 单测：`tests/ui-render.test.tsx`。

`api-protocol.ts` 根据端点和 HTTP 方法选择 `src/shared/contracts.ts` 中唯一的响应 Zod schema；token、revision、error、ack 不在前端重复声明。未知响应或错误形状会被拒绝，而非任意对象当成功。`appearance.ts` 提供三个独立维度和经过校验的可选强调色覆盖。

日期展示显式使用 `Asia/Shanghai`，使 SSR 和浏览器在不同宿主时区下保持同一日期，避免 hydration 不匹配引起界面重建。当前是作者时区的固定默认值，不宣称已支持可配置时区。

`unsaved-guard.ts` 仅用于禁用客户端路由的表单页，监听原生 `beforeunload`，同时设置兼容性 `returnValue`。浏览器决定提示文案；取消后保留输入，组件卸载后释放监听。不使用 Astro preparation 的 preventDefault，因为它会触发整页 fallback，而非取消导航。

设置页额外在 document 捕获阶段对同窗口 HTTP(S) 链接显示显式确认；取消时阻断默认导航。确认仅放行下一次 beforeunload，避免双重弹窗，随后自动恢复原生保护；pageshow 也清除放行状态。新窗口、下载、修饰键点击与页内锚点不受影响。浏览器原生前进/后退及刷新保护的真实提示表现尚待验收，不能把事件单测当作浏览器实测。

## 同主题下拉 `Dropdown.tsx`

全站不使用原生 `select`：设置（服务商、正文字体、提示词动作）、编辑器 AI 对话框（动作、模型、提示词）与发布可见范围、媒体库类型筛选/裁剪比例/图像服务商、Obsidian 保存预设，以及文章类型入口都使用 `Dropdown`。选项为 `{ value, label, disabled? }`；`disabled` 与原生 option disabled 等价：可见、`aria-disabled`、不可点击，方向键/Home/End 跳过。当前值为禁用项时仍显示其文案，打开后活动项落在第一个可用项。`className` 只追加到触发器，用于局部尺寸（如 `.media-tools > .media-filter`）。与原生 `select` 一致，重新选择当前值只关闭菜单、不调用 `onChange`；菜单打开期间选项值或禁用状态变化时，活动项若已不可用会回到已选/第一个可用项。

交互：combobox/listbox 语义，焦点留在触发器并用活动后代；Enter/空格选择，Escape 关闭菜单且阻止冒泡，不会连带关闭外层 `Modal`；Tab/外点关闭不抢焦点。浮层 portal 到 body，样式见 `dropdown.css`，类名前缀 `ui-dropdown-`，继承主题 token。测试：`tests/ui/dropdown.test.tsx`、`tests/ui/type-dropdown.test.tsx`。

模型 ID 输入框的 `datalist` 是可自由输入的建议列表，不属于 select，保持原生。
