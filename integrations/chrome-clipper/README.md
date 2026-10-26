# MadeMe Chrome Clipper

MV3 工具栏弹窗：读取**当前页的选中文字、标题、URL**，展示可编辑 Markdown，再由用户点击保存草稿。没有后台任务、常驻 content script、浏览历史读取或自动整页采集。

## 构建与手动安装

```sh
# 仓库根目录，已有项目依赖即可，无全局安装
node integrations/chrome-clipper/build.mjs
```

人工测试时在 Chrome 扩展页面开启开发者模式，选择“加载已解压的扩展程序”，目录为本模块 `dist/`。本次开发不会替用户安装或运行扩展。

输入自己的站点原点和仅有 `posts:write` 权限的 Token，点击“Allow this site & save”；该动作才请求目标站点权限。选中网页文字，点击扩展，核对内容后保存。URL 的 query/fragment 会移除；长选区最多取前 100,000 个字符，请核对预览。表单/可编辑区的内容不主动读取。无选区时只提供网页链接。

## 权限说明

必选 `activeTab`、`storage`、`scripting`。`scripting` 是 Chrome 单次读取当前选区所必需，并非持续页面访问；[官方 activeTab 文档](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) 说明了这一要求。没有必选 host permissions。可选 HTTPS 匹配模式只用于用户自己输入的站点，在点击事件中[申请具体主机](https://developer.chrome.com/docs/extensions/reference/api/permissions)。Chrome 的主机权限模式跨端口；真正请求仍绑定设置中的精确 origin。

Token 保存在 `chrome.storage.local`，不使用 sync，且 storage 访问级别限制为 trusted extension contexts。它不是操作系统密钥库：能访问浏览器配置的人可能读到它。换站点必须重输 Token；“Forget connection”删除本地值并撤销旧主机授权，服务端 Token 仍需在 Studio 中撤销。

## 未覆盖边界

Chrome 内置页面、扩展页面和某些受限制页面不能注入；不读取 iframe 的选区。弹窗关闭可能打断正在进行的请求，关闭/超时后先检查 Studio，勿立即重复发送。源代码静态检查/打包不代表已在用户 Chrome 中验证，完整步骤见 `../tests/README.md`。
