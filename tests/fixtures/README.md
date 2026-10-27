# 测试数据

valid-image.png 是代码生成的 64×48 纯色 PNG，不含个人信息。
用于真实图片解码、上传、裁剪和下载验收；不能以魔数片段代替浏览器图片测试。

screen-recording.mov 是 ffmpeg 生成的 1 秒 352×364 H.264 QuickTime 文件（`testsrc2` 测试图案，无音轨，ftyp 品牌 `qt  `），结构与 macOS 录屏一致，不含个人信息。生成命令：
`ffmpeg -f lavfi -i "testsrc2=size=352x364:rate=15" -t 1 -c:v libx264 -preset veryslow -crf 40 -pix_fmt yuv420p -an -f mov screen-recording.mov`。
用于 Worker 端到端 .mov 上传、按 video/quicktime 返回与范围读取。

- `x-embed-snippet.html`：作者实际粘贴的 X 官方嵌入代码（blockquote + widgets.js），用于嵌入代码解析、内容检查、编辑器与 Worker 回归；仅作为数据读取，从不渲染。
