# 封面模块

设计约定、当前实现差异、素材格式及展示规则统一维护在 [docs/COVERS.md](../../../docs/COVERS.md)，不在这里复制另一套规范。全部模块入口见 [docs/MODULES.md](../../../docs/MODULES.md)。

| 文件 | 职责 |
| --- | --- |
| contracts.ts | `coverSettingsSchema` 唯一协议、当前比例枚举、默认设置及更换封面时的归一规则 |
| geometry.ts | 相对焦点、contain/cover、缩放及可见区域的纯几何函数 |
| CoverFrame.tsx / styles.css | 首页、文章、编辑器及缩略图共用展示；展示 URL 复用 image-delivery |
| CoverAdjuster.tsx | 比例、展示方式、焦点/缩放的调整与预览 |

设置随文章 JSON/发布快照保存，不单独裁切原文件或新增数据库列。新比例必须同时考虑 Zod 协议、几何、调整器、旧客户端与回归；不能把文档里的待实现项当成已经支持的选项。图片衍生与访问权限由[图片模块](../image-delivery/README.md)及[服务端媒体模块](../../server/media/README.md)维护。
