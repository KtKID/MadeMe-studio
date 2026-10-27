/**
 * C 级：外部服务端点表（唯一出处）。
 * AI 出站主机白名单由这张表推导（AI_PROVIDER_HOSTS），新增供应商只需改这里。
 * 这些地址决定凭据发往哪里，所以只能改代码，不开放给设置页或环境变量。
 */
export const AI_ENDPOINTS = {
  openai: {
    chat: "https://api.openai.com/v1/chat/completions",
    images: "https://api.openai.com/v1/images/generations",
  },
  openrouter: {
    chat: "https://openrouter.ai/api/v1/chat/completions",
    images: "https://openrouter.ai/api/v1/images",
  },
  siliconflow: {
    chat: "https://api.siliconflow.cn/v1/chat/completions",
    images: "https://api.siliconflow.cn/v1/images/generations",
  },
  cloudflare: {
    /** 账户级前缀，后接 /v1/chat/completions、/run/{model}、/models/search。 */
    accountBase: (accountId: string) =>
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`,
  },
  gemini: {
    generate: (model: string) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    models: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=500",
  },
} as const;

/** 出站白名单：从端点表推导，不再单独维护一份主机列表。 */
export const AI_PROVIDER_HOSTS: ReadonlySet<string> = new Set(
  [
    AI_ENDPOINTS.openai.chat,
    AI_ENDPOINTS.openai.images,
    AI_ENDPOINTS.openrouter.chat,
    AI_ENDPOINTS.openrouter.images,
    AI_ENDPOINTS.siliconflow.chat,
    AI_ENDPOINTS.siliconflow.images,
    AI_ENDPOINTS.cloudflare.accountBase("0"),
    AI_ENDPOINTS.gemini.generate("m"),
    AI_ENDPOINTS.gemini.models,
  ].map((url) => new URL(url).hostname),
);

/** SiliconFlow 生成图片的官方下载主机；可用 SILICONFLOW_IMAGE_HOSTS 追加（B 级）。 */
export const SILICONFLOW_IMAGE_DOWNLOAD_HOST =
  "sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com";

/** 各供应商默认图片模型与尺寸（供应商没有填写 imageModel 时使用）。 */
export const AI_IMAGE_DEFAULTS = {
  geminiModel: "gemini-2.5-flash-image",
  cloudflareModel: "@cf/black-forest-labs/flux-1-schnell",
  siliconflowModel: "black-forest-labs/FLUX.1-schnell",
  openrouterModel: "google/gemini-2.5-flash-image",
  openaiModel: "gpt-image-2",
  size: "1024x1024",
  cloudflarePromptMax: 2048,
} as const;

/** Google OAuth / OIDC 端点。 */
export const GOOGLE_OAUTH_ENDPOINTS = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
} as const;
