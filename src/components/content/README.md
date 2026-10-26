# 内容与阅读模块

- `Dashboard.tsx`：搜索、分类、置顶、软删除与恢复；空库不生成假文章。
- `PublicFeed.tsx`：公开文章卡片、分类和搜索。
- `BlockReader.tsx`：将规范 BlockNote JSON 转成转义后的 React/SSR HTML；没有 raw HTML 注入。

## 安全约束

数据可见性由服务器决定，前端过滤不是权限边界。YouTube 使用固定隐私增强域名。X 使用经白名单验证的外链卡片，不执行第三方脚本。受保护文章在验证前不显示正文。

## 测试

`tests/ui-render.test.tsx` 覆盖文本转义、危险链接、白名单嵌入与真实空状态；`tests/e2e/author-flow.spec.ts` 覆盖列表与回收站实际操作。
