# 布局与主题模块

`Base.astro` 提供语义 HTML、语言、视口、站点主题与跳转主内容入口。`Studio.astro` 提供响应式工作台侧边栏、导航与统一页脚。样式位于 `src/styles/global.css`。

强调色仅接受十六进制颜色，避免动态 CSS 注入。主题为 paper / ink / garden / mono，移动端需验证导航与表格不溢出。
