# 新增预设不再预填文章目录

新增和“新增预设”重置将文章目录置为真正未选择的 undefined；只读字段显示 placeholder“请选择目录”。未选择时，即使根校验通过也禁用保存，prepareSave 同步阻断。选择授权根内文章目录后才写入实际相对路径。图片规则 ../asset 不变。
复用 PresetRecord 的 noteDirectory 字段类型；未选择状态只存在于 UI，不修改 Zod 持久化默认值、不迁移旧记录。旧预设空串仍是已明确的仓库根路径，展示“（仓库根目录）”而非未选择；保存原值不变。
红测 1 failed / 69 skipped：/tmp/obsidian-unselected-directory-red.log。覆盖新增、根通过但未选仍禁用、选择后实际路径、重置、旧目录和旧空根路径。完整日志 /tmp/obsidian-unselected-directory-{tests,check,build,smoke}.log。

## 当前重复保存真实流程（仅说明，本轮未优化）
代码基于 save.ts 当前实现：
1. 根下 .mademe-export.json 记录 articleId → path/digest、mediaId → path/digest（save.ts:260–277）。同文章 ID 且目标子目录相同时复用路径；标题改变不会自动重命名旧文件。换目录会分配新路径并更新映射，旧文件保留。
2. 首次保存用安全标题.md，遇陌生同名文件追加稳定 ID/序号，文件名不作为身份（save.ts:288–297、freePath）。
3. 读取磁盘正文、算 SHA-256 与上次清单 digest 比较：实际存在且被本地修改时拒绝，需另存/显式覆盖；实际 NotFound 允许重建原路径（save.ts:276–287）。不靠缓存假定文件仍存在，也不搜索被手工搬走的文章。
4. 每次普通全量保存仍下载媒体；mediaId、目标目录、下载 digest 与本地文件 digest 都匹配才复用并跳过图片写入（save.ts:300–357）。媒体缺失则补写；不同内容/本地改动不会按同名静默覆盖，会分配不冲突文件。
5. 提交前再次核验正文磁盘摘要，拒绝检查期间出现的新修改/陌生同名文件。无论新旧正文内容是否相同，当前仍重写 Markdown 与 manifest，并非同内容零写入；网络媒体请求也不省略（save.ts:404–413）。
6. 仅 Markdown 模式不下载/写图片，正文保留网站远程URL，已有附件与media映射不删除。恢复全量后继续按ID/digest校验媒体（save.ts:242，SaveButton.tsx远程URL处理）。
7. 浏览器内队列/Web Locks串行化；不能锁定外部应用，FSA无原子CAS，多文件不属于原子事务。图片先写、正文后写、manifest最后写；后续失败可能遗留附件或正文/清单不一致，不能声称事务级幂等。

结论：已有身份复用、冲突保护和图片磁盘写入复用；并非“同内容跳过全部写入/下载”。本轮仅移除新增预填目录，不扩展幂等优化。

最终业务验证：84 文件 / 724 测试通过；check 242 文件，0 errors / 0 warnings / 5 既有 hints；build 与 HTTP smoke 通过。未访问本机、未推送业务仓库或部署正式站。
