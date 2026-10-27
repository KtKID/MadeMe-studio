# 工作台会话导航

四个后台深链共享 `loadStudioPageData` 的单次 SSR 引导。身份确认后并行读取文章摘要、媒体和令牌**元数据**，错误独立处理。访客不加载私有列表。

`StudioHistory` 只保存本 document 的 session/index；浏览器后退取消使用 `history.go` 补偿，不 push 伪历史、不破坏前进。补偿期间锁定新导航。未知历史交回完整 SSR。`StudioPaneContext` 只含 active/navigationKey，不存储业务数据。

业务组件在本页会话保持挂载、自持数据；inactive 面板 hidden/inert。没有通用 store、跨文档数据缓存、HTML缓存、localStorage 私有数据或新路由框架。编辑器、新建文章、登录和公开页仍是完整导航。

隐藏窗口/pagehide 立即遮蔽私有面板并清一次性 secret；恢复必须 no-store `/api/identity` 返回 authenticated 且 trustedIdentity 与本次 SSR 相同。失败或任何 API 401/403 卸载私有组件，旧请求不能复活失效会话。权限与所有服务端 no-store 规则保持不变。

设置离开取消保留 URL 和输入，确认放弃回到最新保存基线。保存后更新外壳品牌和媒体 provider 参数。媒体隐藏关闭 modal；令牌离开清一次性值并阻止迟到响应重新显示。

测量沿用原点击→主要数据→React commit→双帧，不以 URL/骨架/预加载结束冒充 ready；仅 active pane 的 navigationKey 触发，图片独立计时。后退取消为 canceled，补偿 pop 不生成成功样本。

测试：`tests/studio-navigation.test.ts`、`tests/studio-loader.test.ts`、`tests/e2e/navigation.spec.ts`、`tests/e2e/studio-shell.spec.ts`。
