# PR8：并发删除封面后的版本安全与冲突二选一

> 历史记录：本报告对应中间提交b2455d9。用户随后取消未上线的本地副本方案，相关模块、入口与写入已撤回；最终A/B二选一行为及验证以[后续报告](2026-11-01-editor-conflict-ab.md)和编辑器README为准。以下测试数量与实现描述仅代表该中间版本。

## 现象与根因

在PR8原head `7f40f0532ba241d33f7a746bf60eebc9984b7d31`，A加载v1，B保存新标题/正文到v2；A实际执行强制删除封面推进至v3，编辑器回调无条件接受v3，却保留v1编辑内容；下一次PATCH携带v3返回200，形成v4并覆盖B的新标题正文。原23项相关测试通过但没有覆盖该并发路径。本轮修改前已用真实Editor/MediaLibrary/DELETE接口、临时SQLite与内存R2复现红色断言，保留完整请求证据；BlockNote在那一轮为替身。

## 修改

- 安全合入最新main `d4158feda2d54cc3d99ba19962cf34ac840b20f4`，保留首页PR9；没有冲突或覆盖现有用户改动。
- `src/server/media/delete.ts`及共享Zod响应：返回清理前后版本。Editor仅匹配完整本地基准时单步推进，不处理缺省版本的猜测；异步回调读取最新表单，保护新换封面。
- `src/components/editor/post-merge.ts`：字段级三方比较，封面/裁切和分类名称/id成组；正文整体比较。独立字段自动合并，双方同字段不同值不静默取一方。一次自动CAS重试后仍更新则重新要求处理。
- `Editor.tsx`站内弹窗只提供“保留我的版本”与“保留我的副本，再加载最新版”；前者仅明确解决已显示冲突，并保留远端独立字段，后者先备份再完整加载。两者不发布文章。新字段冲突、保存/读取期间继续输入、连续服务器更新均保留本地并重新检查；没有块diff/CRDT/force保存。
- `local-recovery.ts`：共享postSchema验证完整基准/本地副本，每次独立键保存并读回核实。存储失败不替换；同文章编辑器顶部“本地副本”选择并恢复，恢复后仍须正常CAS保存。
- 文档同步编辑器、媒体服务、浏览器验收入口；新增模块单测、实际Editor DOM竞态及双页面浏览器回归。

## 验证

最终代码验证：

- `npm test`：109文件、955项全部通过，无跳过。
- `npm run test:integrations`：20/20通过。
- `npm run check`：0 errors、0 warnings、6 hints（既有deprecated/unused提示）。
- `npm run build`：通过，构建产物未提交。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e:conflicts`：3/3通过，真实BlockNote双页面、临时Worker/D1/R2，贯通原bug的真实删除接口并断言旧PATCH version1返回409、安全合并PATCH version3保留B内容返回200。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e:cover`：5/5通过，封面设置、取消/应用/保存/重载/发布与窄屏。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e:home`：2/2通过，合入main后的首页/手机/暗色及边界无回归。
- `git diff --check`：通过。所有运行数据在各次运行器创建的临时目录，结束清理；没有使用生产库或真实媒体。

桌面1280×720、移动412×915冲突弹窗截图已在本地真实浏览器生成并实际查看，使用合成文章。Library官方批量上传工具发现阶段出现网络错误，一次有界重试仍失败，未开始上传，无Library交付ID。截图保留在执行器scratch，不将本地路径当作用户可访问附件。

未主动部署；本轮先更新PR，未合并。远端CI结果以PR对应新head为准，本地结果不冒充远端检查。

## 边界与防回归

副本仅当前网站/浏览器localStorage，不跨设备、不上传服务器；清理网站数据或浏览器存储不可用会失效。副本未加密且不随退出清理，共享设备须保护浏览器。没有修改真实媒体或生产内容，没有生产迁移或部署。

真正浏览器验证使用真实BlockNote、临时本地Worker/D1/R2；UI单测中的BlockNote和网络替身不等同于真实浏览器。保留原失效用例的版本序列，并新增独立字段/同字段、两种选择、存储失败、恢复、取消再打开、异步新增输入、新字段冲突及连续服务器更新覆盖。线上不同浏览器、多设备和真实账号存储策略未验。
