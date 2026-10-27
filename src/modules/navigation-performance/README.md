# 导航性能（基线插桩）

独立的 Zod 协议、纯状态机、浏览器采集器与 React readiness hook。不改变路由、请求策略、缓存或身份权限。

## 使用

在后台 URL 加 `?perf=1`，四个侧栏链接传播该开关。默认不采集；关闭诊断需去掉查询参数并完整刷新。右下角诊断面板的 `#navigation-performance-json` 为完整可读 JSON，点击「导出 JSON」手动下载。没有自动网络上传。

## 口径

`click` 从捕获到侧栏主键点击的绝对 `performance.timeOrigin + performance.now()` 起算，直到目标 React 提交主要数据、hydration 完成，随后两个 animation frame。文章与设置使用已 SSR 的数据；媒体与连接页须初始 API 成功结束。图片下载、离屏图片和后续操作不在该指标内。双帧表示内容可绘制，不是硬件实际出光证明。

初次加载为独立 `initial`，历史切换为 `history`，不可混入点击样本。`first-visit` 仅表示当前诊断历史中首次访问目标，**不等于浏览器、CDN 或服务端冷缓存**；`repeat` 表示重复访问。不得用均值替代每次小于 1 秒的目标，报告须列每路由样本数、最大值和失败样本。

状态包括 `pending / ready / failed / canceled / superseded / timeout`。快速点击替代未完成样本；取消离开保护、同路由重复点击不算成功；必需 API 出错记失败；30 秒超时保留失败记录。后台标签页的 rAF 节流会影响结果，应在可见前台测量。

`sessionStorage` 仅保存最多 200 条严格协议元数据（四个白名单路径、时间、序号、状态、分组、label），不存正文、标题、令牌、原始错误或完整 URL。存储不可用时本页仍显示数据，但无法保证跨完整导航关联。关闭页面自然清除会话数据。

当前 label 为 `baseline`；后续优化保持同一协议与 ready 口径，并将新样本 label 改为 `optimized`。真实对比需同浏览器、相同文章/媒体数量、相同部署环境、多次每个方向；单元测试不是线上实测。

## 测试

`npx vitest run tests/navigation-performance.test.ts`：路由脱敏、跨文档时间、首次/重复、快速替代、取消不可复活、初始/超时、损坏存储。真实浏览器需额外验证四 tab 全部方向、完整导航/ClientRouter、API 失败、未保存取消、快速连点与刷新恢复。

## 可见图片指标

`durationMs` 明确命名为 content-interactive 口径。独立的 `visibleImages` 从同次点击起点计时，只观察内容就绪时 `#main` 内与视口相交且有尺寸的图片；全部 complete 且 naturalWidth > 0 才记 ready；损坏图片 failed、30 秒 timeout、跳走 superseded 分别记录。无可见图 count=0。此指标不阻塞内容样本显示，每 25ms 检查，因此存在至多约 25ms 的采样量化误差；它表示图片成功加载可呈现，不保证 GPU 合成/解码逐帧完成。不自动滚动，不等待离屏 lazy 图片。报告同时列两指标，不能只用内容值声称最终视觉显示达标。
