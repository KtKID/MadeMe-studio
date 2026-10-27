# MadeMe 外部集成离线安装包

版本 0.1.0。各包仅用于手动安装与验收，未替用户安装或连接真实站点。源码 commit、每个源码文件及 ZIP 的 SHA-256 见同目录 `manifest.json`；可用 `sha256sum -c SHA256SUMS`（macOS：`shasum -a 256 -c SHA256SUMS`）检查完整性。

## Chrome

解压 `mademe-chrome-clipper-0.1.0.zip`，保留 `mademe-chrome-clipper/` 文件夹。打开 `chrome://extensions`，手动开启开发者模式，点击“加载已解压的扩展程序”，选择其中含 `manifest.json` 的目录（不是 ZIP 文件）。最低 Chrome 102。

必选权限仅 `activeTab`、`scripting`、`storage`；没有常驻后台或自动全页扫描。可选主机权限声明可匹配 HTTPS，但只在用户输入站点并点击授权时申请具体主机。选中网页文字 → 打开扩展 → 审阅预览 → 保存草稿。Token 存浏览器本地，不是系统密钥库；“Forget connection”清除本地连接，服务器 Token 需另行撤销。不要把含 Token 的浏览器配置打包分享。

## Obsidian

解压 `mademe-publisher-0.1.0.zip`。先用无私人数据的专用测试 vault，手动将完整 `mademe-publisher/` 放到 `.obsidian/plugins/`。目录内必须直接存在 `manifest.json`、`main.js`、`styles.css`，不能多嵌一层。手动允许社区插件并启用 MadeMe Publisher；最低 Obsidian 1.5.0。

设置自己的站点后，Token 仅在当前会话内存中。打开一篇测试 Markdown，用命令面板“Preview current note as MadeMe draft”，核对全部内容并确认保存；不会扫描其他笔记或上传附件。安装包没有 `data.json`，不要将私有 vault 或配置分享。桌面/移动实际宿主兼容性仍需人工验收。

## 单文件 Agent CLI

解压 `mademe-agent-publisher-0.1.0.zip`。其中 `publish.mjs` 已包含所需 JS 依赖，不需要 `npm install` 或 `node_modules`。需预先安装 Node 22.18+，安装本身可离线完成；向站点保存时才需要网络与用户授权的连接。

```sh
cd mademe-agent-publisher
node publish.mjs --help
# 只预检所选文件，不联网，不需要 Token；输出完整正文，请勿用于共享日志中的私人文章
node publish.mjs --file /明确路径/测试文章.md --site https://your-site.example --dry-run
# MADEME_API_TOKEN 由受保护环境提供，不写在命令、源码或聊天中
# 获得明确写入授权后，去掉 --dry-run 只发送一次默认草稿
```

不提供 Token，不自动创建 Token。草稿需要 `posts:write`；独立发布还需要 `posts:publish` 和明确授权。超时先到 Studio 核实，不盲重试。随包 README/SKILL 保留源码路径示例；运行本离线包时改用本目录 `node publish.mjs`。

## 源码与复现

`mademe-integrations-source-0.1.0.zip` 包含独立 integrations 源码、测试与实际构建使用的 `src/shared/contracts.ts`，不是完整网站源码。业务文件固定在 manifest 的 sourceCommit，不混入其他模块开发中的改动；安装与验收文档包含本次更新。原始 CLI 源码仍引用共享 TS/Zod，直接运行源码需要项目依赖；上述离线 CLI 包无需这些依赖。

在对应提交的完整 MadeMe 仓库、已装现有依赖的环境执行：

```sh
node integrations/scripts/package.mjs /tmp/mademe-integrations-new-delivery
```

目标目录必须为空。脚本不安装依赖、不请求网络、不创建凭据；使用现有 Node、esbuild、Zod、Python 3、unzip，隔离构建并验证 ZIP。Zod 许可随各运行包附带。

## 验收与保留

已验证构建、19 项本地测试、CLI 离线 help/dry-run 和归档结构；**不等于真实 Chrome/Obsidian/目标 API 已验收**。安装与真实写入须由用户授权后进行。当前版本开发完成前保留测试文章，已获准发布时用仅链接可见；完成后先交付验收，验收后再获明确授权才能清理。详见源码包 `integrations/tests/LIVE_API_E2E.md`。
