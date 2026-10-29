# Obsidian 打开根层级修复（2026-10-28）

## 真实证据与红测

用户从应用复制的真实 URI：`obsidian://open?vault=brain&file=01_%E7%AC%94%E8%AE%B0%2FMadeMe`。
网站旧链接：`vault=TechNote&file=brain/01_笔记/MadeMe.md`（展示解码值）。因此根因是把授权父目录当成 Obsidian 仓库，而非 URL 编码错误。未访问用户设备；实际配置目录存在性仍需现场运行验证。

先写真实 SaveButton UI 回归，以授权根 → 嵌套仓库 → 文章目录夹具重现，运行：

```sh
./node_modules/.bin/vitest run tests/ui/obsidian-local.test.tsx -t '真实URI回归'
```

实现修改前结果：1 failed / 28 skipped，期望 `brain`、收到 `TechNote`；红测日志 `/tmp/obsidian-root-red.log`。确认红并报告后才修改实现。此前调查没有真实 URI，诊断用例直接通过，不曾冒称已修复。

## 最小修复

- `resolveObsidianUri` 仅沿实际保存文章路径获取目录句柄，再从文章目录向授权根检查 `.obsidian` 是否存在，取最近候选。
- 不遍历兄弟目录，不读正文或配置内容，不访问根之外，不创建目录或写死任何设备路径/仓库名。
- 示例现在生成 `vault=brain&file=01_笔记/MadeMe.md`，与应用复制链接等价；[官方 URI 协议](https://obsidian.md/help/uri) 允许省略或保留 `.md`。
- `saveToDirectory` 的路径、参数和文件内容未改。没有增加设置字段、checkbox、确认操作或插件。
- 无标记不猜测仓库；权限/IO/类型错误原样上报，不能回退到错误外层。打开探测发生在文件已保存后，故错误文案明确文件已保存，但打开目标无法确认，不误报文件保存失败。

## 证据边界

最近 `.obsidian` 仅是自动定位候选，不能验证本机 Obsidian 注册表。多层标记选择最近项，不能识别其是否残留；自定义 configDir 或未登记仓库也不承诺自动打开。没有扫描更多目录来消除这些限制，也没有以假定授权把用户绝对路径写入程序。

## 验证

- 新增 9 项，覆盖真实 URI、保存路径不变、嵌套/外层标记、无标记、特殊字符、禁止越界/旁支读取、权限/IO异常与保存后错误语义。
- 全仓 82 文件 / 661 项通过。
- check 240 文件：0 errors / 0 warnings / 5 既有 hints。
- build / HTTP smoke：通过。
- 真实 UI 红测已绿；jsdom 不实现外部应用协议，未声称用户 Obsidian 已成功打开。
- 未推送、未部署；待部署后在真实本机验证候选 `.obsidian` 与原生打开结果。
