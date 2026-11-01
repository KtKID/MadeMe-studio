# 2026-10-31：媒体库新增删除按钮与 DELETE /api/media/:id

## 需求

KID：“每个图片下的按钮新增一个删除”；批准新增 `DELETE /api/media/:id`，“删除后只清封面，正文不动”。

## 实现

- **接口** `DELETE /api/media/:id`（`src/server/media/delete.ts`，路由在 `src/server/api.ts`）：`media:write` 作用域；同源校验沿用全局 `assertSameOrigin`，未放宽。
- **引用检查**：草稿文档与已发布快照（含回收站文章）中出现 `/api/files/<id>` 即视为引用；未带 `?force=1` 返回 409 `MEDIA_IN_USE`，`details.posts` 列出 `{postId,title,cover,body,published,trashed}`，不做任何修改。
- **强制删除只清封面**：草稿封面置空（版本 +1，修订 `save`）；已发布快照封面若相同也置空。理由：文件删除后线上封面必然失效，置空让线上页面干净地不显示封面，且不触碰已发布内容的其它字段；只清草稿会让线上长期显示坏图。正文引用不动（作者确认的取舍）。冲突重试 3 次，仍冲突 409，此时尚未删除任何媒体数据。
- **删除顺序**：清封面 → 删 D1 行 → 删 `row.object_key` → 前缀列举删除 `image-derivatives/v1/<id>/`（含 `s1/`、manifest）。行删除后的 R2 失败记 `media.delete_orphan_*` 错误日志并仍返回成功。为此 `R2Bucket` 接口补充了 `list`（真实 R2 绑定原生支持），测试替身同步实现。
- **前端**：卡片操作行末尾新增 `Trash2` 图标按钮（“删除”，`icon-button danger`）；`Modal` 确认 → 409 时列出引用文章并要求“仍然删除”二次确认；忙碌态禁用；失败显示在对话框并写 `media.delete_failed`；成功从列表移除。编辑器 `onDeleted`：清空当前封面，若服务端清了本文封面则同步版本号，避免下次保存版本冲突。
- **其它**：令牌作用域说明 `media:write` 改为“上传和删除媒体”；媒体库空状态去掉已不成立的“原图会保留”。常量 `MEDIA_DELETE_COVER_RETRIES`、`MEDIA_DELETE_LIST_PAGE` 在 `src/modules/config/limits.ts`。

## 验证

- vitest 全量通过（新增 `tests/backend/media-delete.test.ts` 5 项：无引用删除含两套衍生且不误删同前缀他人对象、409 列表、force 清草稿+已发布封面且正文不动含回收站文章、对象删除失败记孤儿日志、未登录/跨站 Origin/未知 ID）；UI 测试 4 项（媒体库删除 3 项、编辑器封面同步 1 项）。
- test:integrations、astro check（0 错误）、build 通过。
- 真实 Worker E2E（`npm run test:e2e:images`）4/4，含新增删除用例：取消不删、确认后卡片消失、文件 404。

## 已知限制

- 正文中引用被删图片的位置会显示失效图片（按要求不改正文）。
- 公开图片在边缘缓存中最多仍可命中 600 秒。
- 拥有 `media:write` 的 API 令牌现在也能删除媒体。

未合并、未部署。
