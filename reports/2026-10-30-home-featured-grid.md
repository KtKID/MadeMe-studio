# 首页刊物主次与四列文章网格

## 目标与基线

用户要求首页有三篇重点展示（左侧一张大封面，右侧上下两张小封面），下方普通文章按从左到右再换行排列，宽屏每行约四篇，只保留封面和标题。

2026-10-30 实时 `git fetch origin main` 后，从 `origin/main` 的 `a85f0257b34407e3bd1b15668e552ed44c118f32` 创建全新本地分支 `feat/home-featured-grid`。远端同名分支查询为空。没有沿用旧功能分支，也没有 push、合并或部署。

已读取 [Anthropic Research](https://www.anthropic.com/research) 的当前正文，参考重点内容与文章 gallery 的层级；三篇结构以用户明确要求为准。该站在执行环境的浏览器访问报 `ERR_TUNNEL_CONNECTION_FAILED`，HTTP 代理返回 403，因此没有取得参考站的浏览器截图；MadeMe 的本地页面已实际运行并截图。

## 现象与原因

原默认刊物只有首篇横向大图，下方使用三列包含摘要、标签、日期的完整卡片；不符合三篇主次和四列简洁列表。原首页标语区域较高，文章进入首屏较晚。

## 实现

- `HomeFeaturedPosts.tsx` 与独立样式负责默认 `paper`（编辑刊物）版面。主篇左大、两篇次要文章右侧上下排列；普通文章四列按行排列，不使用瀑布流。
- 沿用 `PublicFeed` 既有“置顶优先、发布时间倒序”。筛选后的前三篇进入重点区，其余进入普通区，不重复。没有置顶时取最新三篇。后台置顶、公开快照、发布排序和发布时间协议未修改。
- 主篇保留摘要，重点文章显示类型/日期；普通区只有封面和标题。分类下拉和标题、摘要、标签搜索继续有效，筛选后重新分组。
- 缺少封面复用既有抽象图；一篇/两篇自动收缩，零篇沿用真实空态；长标题完整换行。当前基线没有 `coverSettings` 字段，只有 `coverImage`，继续使用原图片地址与现有 `object-fit: cover`，没有写回裁剪图。
- 普通区 960px 以下两列，360px 以下一列；680px 以下主篇置上、次篇改成小封面横排。保留原品牌、导航、RSS、页脚、明暗/皮肤/字体 tokens。其它 `ink` / `garden` / `mono` 布局保留；设置中的刊物说明同步为“三篇重点 · 四列文章”。
- 首页标语改为紧凑单行并压缩上下空白，装饰缩小，突出实际文章。
- 新增隔离 E2E 运行入口 `npm run test:e2e:home`，自动建立临时 Worker/D1/R2，使用合成文章与 Canvas 封面，结束清理实例和数据。

## 验证结果

测试先行：新组件回归最初运行 5 项，2 项因缺少重点/普通区而失败；实现后通过。完整 Vitest 首次发现旧“阅读 one”可访问链接名称丢失，恢复原阅读名称后重新运行全套通过。

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | 94 个文件、841 项通过 |
| `npm run check` | 0 errors、0 warnings、5 条既有 hints（未使用导入与 beforeunload returnValue 弃用） |
| `npm run build` | 通过；既有大型客户端 bundle 提示仍存在 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e:home` | 2 项通过，6.0 秒（访客冒烟 + 刊物真实浏览器） |
| `npm run test:smoke` | 真实 HTTP 冒烟通过 |
| `npm run test:worker` | 真实 Worker/D1/R2 HTTP 端到端通过 |
| `git diff --check` | 通过 |

浏览器断言覆盖：1440px 左大右双卡几何、普通区首行四列及第二行顺序；768/390/320px 布局和标题无横向溢出；缺封面、一篇/两篇/搜索零篇；连续英文与长中文标题；实际图片解码；系统明暗切换；Pixel 7 Android 触屏模拟；关闭 JavaScript 后公开文章和真实链接仍可阅读。已目视检查桌面浅色/深色和 Android 浅色截图。模拟 Android 不是实体手机验收，其它浏览器和所有皮肤组合未全部验收。

版本：Node v24.19.0、Astro 7.4.2、React 19.2.6、Vitest 4.1.12、Playwright 1.64.1、系统 Chromium 154.0.8037.57。依赖按现有锁文件安装，未更新依赖版本。

## 截图与交付阻塞

实际截图保存在本执行环境 `/workspace/scratch/mademe-home-screenshots/`：`home-desktop-light.png`、`home-desktop-dark.png`、`home-mobile-light.png`、`home-mobile-dark.png`、`home-tablet-dark.png`、`home-android-light.png`、`home-android-dark.png`。均是本地真实页面与合成验收内容，不包含私人文章。

使用当前 Library 技能的 prepared-upload 流程尝试保存桌面/Android 的浅色和深色四张截图。上传助手在应用发现阶段返回 `hosted apps tools/list request failed: network`，尚未准备或上传文件；没有返回任何 `library_file_id`。未绕过该流程改用其它写入路径。本地路径不是可访问附件，父线程交付时不能把它冒充已上传链接。

交付复核时，按父线程新增指示，使用同一官方流程对桌面浅色与 Android 浅色两张图做了一次有界重试，再次在 `tools/list` 阶段返回同样的 `network` 错误。仍未开始上传、未返回上传会话或文件 ID；这是网络失败，不是权限拒绝，未继续重试或改换写入路径。已验证本地 PNG 文件头与 IHDR 尺寸：桌面浅色 `1440 × 1572`、349227 字节；Android 浅色 `1082 × 4930`、694304 字节（设备模拟包含 DPR）。

## 后续回归要求

保持内容分组与发布协议隔离；变更断点或卡片尺寸时运行真实浏览器几何检查，不能只依赖 SSR/DOM 测试。其它首页布局继续按作者既有选择生效；要使用本次版面应选择“编辑刊物”。没有擅自加入精选后台或发布时间编辑。
