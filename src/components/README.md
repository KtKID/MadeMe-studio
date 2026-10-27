# 前端模块

采用 Astro 服务端阅读页面与 React 客户端交互岛。编辑器为真正的 BlockNote，不以 textarea 替代富文本正文。

- [常驻工作台外壳](studio/README.md)
- [共享界面与协议适配](shared/README.md)
- [内容列表与安全阅读](content/README.md)
- [块编辑与发布](editor/README.md)
- [媒体与图片](media/README.md)
- [站点设置](settings/README.md)
- [外部连接](integrations/README.md)
- [布局与主题](../layouts/README.md)

## 开发时序说明

本轮最早一批界面实现先于用户追加的测试先行要求，不能称为完整 TDD。要求到达后，先补充明确的单元、冒烟及端到端断言，再继续入口接线与缺陷修复。未实际运行的浏览器用例不算验证通过。
