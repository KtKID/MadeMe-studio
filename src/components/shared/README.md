# 共享界面与协议适配

`ui.tsx` 提供服务端共享 Zod 类型的前端引用、同源 API 调用、错误分类、URL 校验、对话框、空状态和下载辅助函数。敏感凭据不写 localStorage。

## 边界与测试

- API 错误保留 HTTP 状态和错误码，409 交给编辑器显式处理。
- URL 只接受 HTTP(S) 或根相对路径；拒绝 JavaScript/data 等执行协议。
- 单测：`tests/ui-render.test.tsx`。

`api-protocol.ts` 根据端点和 HTTP 方法选择 `src/shared/contracts.ts` 中唯一的响应 Zod schema；token、revision、error、ack 不在前端重复声明。未知响应或错误形状会被拒绝，而非任意对象当成功。`appearance.ts` 提供三个独立维度和经过校验的可选强调色覆盖。

日期展示显式使用 `Asia/Shanghai`，使 SSR 和浏览器在不同宿主时区下保持同一日期，避免 hydration 不匹配引起界面重建。当前是作者时区的固定默认值，不宣称已支持可配置时区。

`unsaved-guard.ts` 同时监听窗口离开与 Astro 客户端导航；取消导航保留输入，组件卸载后释放全部监听。
