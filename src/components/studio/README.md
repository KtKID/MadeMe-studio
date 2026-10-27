# 工作台外壳

`StudioShell` 协调四个常驻业务面板、链接与浏览器历史、设置离开保护、身份恢复。业务数据不搬进 shell store：文章、媒体、设置、连接模块仍各自维护自己的状态。完整导航保留 SSR 和真实 href。

边界及安全约束见 [会话导航模块](../../modules/studio-navigation/README.md)。
