# 文章保存前重新校验仓库根

## 事实与范围
用户截图是设置中的预设编辑表单：根目录 TechNote、文章子目录 brain/01_笔记；截图本身没有成功反馈，也不能证明用户磁盘上是否存在 .obsidian。
代码核验：根目录 Browse 和保存预设确认已有直属 .obsidian 检查；实际文章 saveTransaction 原先没有检查，历史预设或根标记被移除后，全量和仅 Markdown 模式均能写入。这是可复现的独立遗漏，不冒称能解释截图全部现场情况。

## 最小修复
在实际保存事务开始、任何目录创建/媒体读取/文件写入之前复用 verifyVault(root)。无根标记提示“这个路径没有检测到 Obsidian 仓库，请重新选择”，停止本次保存，不删除旧记录或文件、不修改保存目的地。权限和 IO 异常原样传播，不伪装普通目录。只检查授权根直属 .obsidian，不要求文章子目录包含标记，不扫描其它位置。
所有模式共用这一边界，包括仅 Markdown、另存和确认创建目录。旧预设的 isVault 缓存不参与授权判断；原先普通下载降级不受影响。

## 验证
先红：/tmp/obsidian-root-save-red.log，adapter 2 failed / 23 passed：首次成功后删除根标记，再保存全量或仅 Markdown 原先错误地成功。
补充：真实临时磁盘创建/删除 .obsidian 验证失败无新文件/目录；合法根的文章子目录无需标记；权限/IO传播；失败不 fetch 图片、不改旧文件。
设置确认回归使用真实 verifyVault（非固定 boolean mock），历史 isVault=false/true 的缺标记句柄都拒绝且不调用 put/delete。jsdom 跨 realm 的 DOMException 不作原生授权验收，模拟使用具名 Error；原生浏览器 picker 仍未实测。

完整 tests：84 文件 / 701 用例通过；check：242 文件、0 errors / 0 warnings / 5 既有 hints；build 与 HTTP smoke 通过。日志 /tmp/obsidian-root-save-{tests,check,build,smoke}.log。目录标记只是本地 Obsidian 配置目录存在性检查，不证明应用已登记该仓库；FSA 不提供原子跨应用事务，校验后外部程序再删标记的竞争窗口不能承诺消除。
