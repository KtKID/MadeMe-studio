# 网页Markdown附件清单与选择累加修复

## 现象与根因

用户反馈页面出现两个原生Choose Files按钮，且两张图片分两次选择后第一张消失。真实本地旧页面截图确认两个裸露file input；代码每次setAssets新数组而非累加，是覆盖根因。multiple原本就存在，不是一次多选属性缺失。

## 修复范围

基于main cbe2a54，新分支fix/markdown-import-guided-flow，仅本地开发，未push/PR/合并/部署。

- 选MD立即共用解析器列出名称、类型、来源和状态；本地待补充，HTTPS/本站媒体保留，不假装自动取得旁文件。无本地附件直接确认导入。
- 一个主要补充附件入口，支持多选和分次累加；文件夹匹配收在辅助说明。隐藏所有原生file input，用现有Modal、button样式和主题变量，不替换系统文件选择窗口。
- selection.ts仅比较真正引用的同名同大小文件字节去重，不读取未引用文件内容；同名异图保留并报冲突。指定项可移除/替换，取消选择保留之前文件。
- 连续选择排队、关闭/新来源失效保护；文件夹和显式补选共用匹配，保留根边界和上传前整体校验。
- 普通超链接原样保留；有明确后缀的嵌入视频沿用既有转换，不增加服务器拉取或持久权限。

## 验证

- 新增UI回归先红：分次选择覆盖、无附件仍显示上传附件按钮；修正测试环境缺少toBeDisabled matcher后记录真实失败。
- 116文件/1028项Vitest、23项Node客户端、check 0 errors/0 warnings/6 hints、build通过；插件SDK检查/打包、Chrome打包、隔离Worker/HTTP smoke通过。
- 8项真实Chromium/API E2E通过。新增场景从磁盘选择MD，实际列出5处引用，两张图分次添加且重复重选不重复，GIF/本地MP4一次多选，4次真实media上传、PATCH保存、刷新显示3图2视频且视频实际播放。保留普通视频超链接。
- 远程HTTPS视频使用受控响应返回合成H.264文件，验证链接保留和实际解码，不声称任意外站可达。GIF原字节、两帧及实际动画由现有真实浏览器回归继续覆盖。
- 1440/768/390/360宽度无横向溢出，按钮可见；手机是Chromium视口，不是Android真机OS授权验收。
- 截图来自隔离本地Worker/D1/R2和合成素材，不是生产；测试结束清理临时数据库，不改用户内容。

## 交付与限制

实际查看本地旧/新截图。desktop-detected.png 580×790，desktop-ready.png 580×756，mobile-ready.png 390×844。原用户三张Library截图官方materialize及一次有界重试均download failed，未能在本执行器看像素，不冒称已看。截图Library上传helper在tools/list网络步骤失败，未开始prepare/finalize、未生成ID；一次同路径重试仍失败。

原生Obsidian未安装/未跑；插件现有vault附件读取路径与浏览器单文件授权不同。纯MD不包含本地附件字节，网页不能无授权访问旁文件。仅有链接的MD可直接保留资源；本地资源仍需明确补充选择。

日志：/tmp/md-guided-{red,green,unit,check-final,build,e2e,integrations,worker,smoke}.log。

## 避免回归

文件选择必须复用累加/去重函数，保留File身份与已上传缓存；测试同时覆盖一次多选、分两次选、同名异内容、取消/重选，不能只断言multiple属性。改UI后必须实际打开本地页面查看桌面和手机像素，不能以API测试通过替代按钮/布局验收。
