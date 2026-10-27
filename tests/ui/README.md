# DOM 组件交互回归

使用 Vitest、jsdom 与 React Testing Library 渲染实际 React 组件，通过 DOM 点击、输入、关闭与延迟响应，检查状态、请求数量、错误提示和数据保护。运行 `npm run test:ui`，也会被 `npm test` 收集。

## 测试边界

- `workspace-clicks.test.tsx`：实际 Dashboard 与 Integrations。覆盖筛选、错误显示、取消、重复请求、失败重试、令牌创建/隐藏及撤销竞态。API 是隔离 mock，不创建任何真实令牌或删除服务器文章。
- `editor-clicks.test.tsx`：实际 Editor、React 状态与 Modal，BlockNote 重引擎替换为小型测试边界。覆盖返回取消/确认，以及保存、历史恢复、冲突重载、文件读取等待期间的新输入保护。
- `media-clicks.test.tsx`：实际媒体组件的按钮/文件输入/延迟响应回归，详见用例。

- `settings-clicks.test.tsx`：实际设置五个面板、导航/模型/提示词/主题控件、保存失败重试及 dirty 状态。API 为隔离 mock，不改变生产设置。
- `author-account.test.tsx`：工作台侧边栏账号名渲染（登录/未登录/缺账号）、登录页账号展示、`ownerAccount` 模式矩阵与头像字母。
- `public-auth-clicks.test.tsx`：公开列表筛选、密码解锁、现有登录表单校验/重复提交/失败重试；不配置真实认证或使用真实凭据。

这不是浏览器 E2E。jsdom 没有真实布局、Canvas、文件选择器或浏览器 beforeunload 界面，不能用此结果证明 Chrome/Safari 原生弹窗、视觉或上传端到端已验收。真实浏览器操作与 Worker/D1/R2 HTTP 测试分别记录。

测试先行记录：Dashboard 初始错误用例在修复前因缺少 alert 明确失败，修复后通过。其它竞态由对应业务模块的失败回归与此 DOM 层共同覆盖，不将后补 DOM 用例伪称全部先于实现。
