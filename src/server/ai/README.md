# AI 与图像适配器模块

## 文件分工

- `service.ts`：公开入口，供 HTTP API 使用。
- `text.ts`：写作动作、作者 Prompt 与文本协议适配。
- `images.ts`：多提供商图像协议、安全解码与持久化。
- `models.ts`：各提供商模型发现与 ID 规范化。
- `protocols.ts`：上游响应 Zod 校验，不透传任意对象。
- `transport.ts`：固定官方端点、超时、响应上限、拒绝重定向与安全错误。

## 支持能力

| 提供商 | 文本 | 图像 | 模型发现 |
| --- | --- | --- | --- |
| OpenAI | Chat Completions | Images generations，支持配置 `imageModel` | `/v1/models` |
| OpenRouter | Chat Completions | 专用 `/api/v1/images`，仅接受 base64 图片 | `/api/v1/models` |
| SiliconFlow | Chat Completions | Images generations，再下载白名单临时文件 | `/v1/models` |
| Cloudflare Workers AI | 官方 OpenAI-compatible Chat Completions | `/ai/run/{model}`，支持 base64 或图片二进制 | `/ai/models/search` |
| Google Gemini | 官方 `generateContent` | Nano Banana `generateContent` 与 `inlineData` | 官方 models API |

`model` 用于文本；可选 `imageModel` 独立用于生图，不会拿文本模型名默认为图像模型。模型 ID 可配置，实际账户可用性由提供商决定。默认模型不构成可用性或价格保证，调用前应通过模型列表和账户配置确认。

## 安全配置

密钥只通过运行时提供：`OPENAI_API_KEY`、`OPENROUTER_API_KEY`、`SILICONFLOW_API_KEY`、`CLOUDFLARE_AI_TOKEN`、`GEMINI_API_KEY`。Cloudflare 还需合法账户 ID。OpenAI 图像可使用单独的 `IMAGE_API_KEY`；未选定图像模型时可使用 `IMAGE_MODEL` 默认值。

不接受客户端任意 base URL。所有 API 主机固定白名单；密钥仅放请求头，不进入 URL、日志或返回内容。请求禁止重定向，响应有体积上限。Gemini 思考标记的文字或图片不作为最终输出保存。

SiliconFlow 临时图片仅允许 HTTPS 精确主机白名单，不转发 API 密钥、Cookie 或重定向。默认允许官方示例使用的对象存储主机；管理员可通过 `SILICONFLOW_IMAGE_HOSTS` 明确补充已验证主机，不支持通配符、IP、本地域名或客户端覆盖。主机变更时安全拒绝，不自动放开。

生成结果仅接受 PNG/JPEG/WebP，继续经过媒体 MIME/文件签名验证后写入 R2/D1。SVG、任意 URL-only 图像响应、缺少图像、错误 JSON 都明确失败，绝不生成假历史记录。

## 验证与限制

新增能力先添加 16 个 fixture 用例，首跑 13 个失败，再实现转绿；额外边界用例覆盖 SSRF、SVG、路径注入、错误 JSON、响应上限、模型发现与缺密钥。测试模拟上游 HTTP 协议，但使用真实 SQLite 存储元数据。

没有真实凭据时不执行有费用调用。因此这些结果证明协议与安全分支，不代表真实账户、配额、区域或具体模型已线上联调。无密钥返回 503 配置错误，未知模型由提供商返回明确错误。

## 官方协议依据

- [OpenAI Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [Gemini 图像生成 generateContent 协议](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [Gemini 模型发现](https://ai.google.dev/api/models)
- [OpenRouter 图像 API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [SiliconFlow 图像 API](https://docs.siliconflow.com/en/api-reference/images/images-generations)
- [SiliconFlow 官方对象存储示例](https://docs.siliconflow.cn/docs/userguide/capabilities/vision)
- [Cloudflare OpenAI-compatible 文本协议](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [Cloudflare 图像模型 REST 示例](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/)
- [Cloudflare 模型发现](https://developers.cloudflare.com/api/resources/ai/subresources/models/methods/list/)
