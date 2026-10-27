import { providerCapabilities } from "./capabilities";
import { z } from "zod";
import { imageInputSchema, type Provider } from "../../shared/contracts";
import type { RuntimeEnv } from "../runtime";
import { AppError } from "../errors";
import { logCaught, logger } from "../../modules/log/server";
import { providerKey, readSettings } from "../settings";
import { saveMedia, validateMedia } from "../media/service";
import {
  AI_ENDPOINTS,
  AI_IMAGE_DEFAULTS,
  AI_PARAMS,
  GENERATED_IMAGE_MAX_BYTES,
  GENERATED_MEDIA_POLICY,
  IMAGE_DOWNLOAD_TIMEOUT_MS,
  SILICONFLOW_IMAGE_DOWNLOAD_HOST,
} from "../../modules/config";
import {
  cloudflareBase,
  geminiURL,
  providerRequest,
  readProviderBytes,
  readProviderJSON,
} from "./transport";
import {
  cloudflareImageSchema,
  geminiResponseSchema,
  imageResponseSchema,
  siliconImageSchema,
} from "./protocols";

type ImagePayload = { bytes: Uint8Array; mime: string };
const supportedImageMime = new Set(["image/png", "image/jpeg", "image/webp"]);
export function hasConfiguredImageProvider(
  providers: Provider[],
  env: RuntimeEnv,
) {
  return (
    !!(env.IMAGE_API_KEY || env.OPENAI_API_KEY) ||
    providers.some((p) => providerCapabilities(p, env).imageConfigured)
  );
}
function mimeFromBytes(bytes: Uint8Array) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new AppError(
    502,
    "INVALID_IMAGE_RESPONSE",
    "The provider returned an unsupported image format.",
  );
}
function decodeImage(value: string, mime?: string): ImagePayload {
  const base64 = value.replace(/\s/g, "");
  if (
    !base64 ||
    base64.length > 35_000_000 ||
    !/^[a-zA-Z0-9+/]+={0,2}$/.test(base64)
  )
    throw new AppError(
      502,
      "INVALID_IMAGE_RESPONSE",
      "The provider returned invalid image data.",
    );
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    throw new AppError(
      502,
      "INVALID_IMAGE_RESPONSE",
      "The provider returned invalid image data.",
    );
  }
  const actual = mime ?? mimeFromBytes(bytes);
  if (!supportedImageMime.has(actual))
    throw new AppError(
      502,
      "INVALID_IMAGE_RESPONSE",
      "The provider returned an unsupported image format.",
    );
  validateMedia(bytes, actual, GENERATED_MEDIA_POLICY);
  return { bytes, mime: actual };
}
function safeDownloadURL(value: string, env: RuntimeEnv) {
  const hosts = new Set<string>([SILICONFLOW_IMAGE_DOWNLOAD_HOST]);
  for (const raw of (env.SILICONFLOW_IMAGE_HOSTS ?? "").split(",")) {
    const host = raw.trim().toLowerCase();
    if (
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)
    )
      hosts.add(host);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      502,
      "UNSAFE_IMAGE_URL",
      "The provider image URL is not permitted.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname) ||
    url.hash
  )
    throw new AppError(
      502,
      "UNSAFE_IMAGE_URL",
      "The provider image URL is not permitted. Configure an exact trusted image host if required.",
    );
  return url.href;
}
async function downloadImage(
  value: string,
  env: RuntimeEnv,
): Promise<ImagePayload> {
  const url = safeDownloadURL(value, env);
  let response: Response;
  // 下载地址仅来自受信提供商响应且命中精确白名单；绝不转发模型密钥或浏览器 Cookie。
  try {
    // Workers 不支持 redirect "error"；用 "manual"，下方 !response.ok 拒绝任何 3xx，不跟随到白名单外主机。
    response = await fetch(url, {
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    logCaught("ai.image_download_failed", error, {
      host: new URL(url).hostname,
    });
    throw new AppError(
      502,
      "IMAGE_DOWNLOAD_FAILED",
      "The generated image could not be downloaded.",
    );
  }
  if (!response.ok) {
    logger.error("ai.image_download_http_error", {
      host: new URL(url).hostname,
      httpStatus: response.status,
      redirected: response.status >= 300 && response.status < 400,
    });
    throw new AppError(
      502,
      "IMAGE_DOWNLOAD_FAILED",
      "The generated image could not be downloaded.",
    );
  }
  const bytes = await readProviderBytes(response, GENERATED_IMAGE_MAX_BYTES);
  const mime = mimeFromBytes(bytes);
  validateMedia(bytes, mime, GENERATED_MEDIA_POLICY);
  return { bytes, mime };
}
async function generatePayload(
  env: RuntimeEnv,
  provider: Provider,
  key: string,
  prompt: string,
  timeoutMs: number,
): Promise<ImagePayload> {
  if (provider.kind === "gemini") {
    const model = provider.imageModel || AI_IMAGE_DEFAULTS.geminiModel;
    const response = await providerRequest(geminiURL(model), key, {
      google: true,
      timeoutMs,
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
    });
    const data = await readProviderJSON(response, geminiResponseSchema);
    const part = data.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .find((p) => !p.thought && p.inlineData)?.inlineData;
    if (!part)
      throw new AppError(
        502,
        "EMPTY_IMAGE_RESPONSE",
        "The provider returned no image.",
      );
    return decodeImage(part.data, part.mimeType);
  }
  if (provider.kind === "cloudflare") {
    const model = provider.imageModel || AI_IMAGE_DEFAULTS.cloudflareModel;
    if (!/^@(cf|hf)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model))
      throw new AppError(
        422,
        "INVALID_MODEL",
        "Choose a valid Cloudflare image model ID.",
      );
    if (prompt.length > AI_IMAGE_DEFAULTS.cloudflarePromptMax)
      throw new AppError(
        422,
        "IMAGE_PROMPT_TOO_LONG",
        `Cloudflare image prompts support at most ${AI_IMAGE_DEFAULTS.cloudflarePromptMax} characters.`,
      );
    const response = await providerRequest(
      `${cloudflareBase(env)}/run/${model}`,
      key,
      { body: { prompt }, timeoutMs },
    );
    if (response.headers.get("content-type")?.startsWith("image/")) {
      const bytes = await readProviderBytes(response, GENERATED_IMAGE_MAX_BYTES);
      const mime = mimeFromBytes(bytes);
      validateMedia(bytes, mime, GENERATED_MEDIA_POLICY);
      return { bytes, mime };
    }
    const data = await readProviderJSON(response, cloudflareImageSchema);
    const image = data.result?.image ?? data.image;
    if (data.success === false || !image)
      throw new AppError(
        502,
        "EMPTY_IMAGE_RESPONSE",
        "Cloudflare returned no image.",
      );
    return decodeImage(image);
  }
  if (provider.kind === "siliconflow") {
    const response = await providerRequest(
      AI_ENDPOINTS.siliconflow.images,
      key,
      {
        timeoutMs,
        body: {
          model: provider.imageModel || AI_IMAGE_DEFAULTS.siliconflowModel,
          prompt,
          image_size: AI_IMAGE_DEFAULTS.size,
          batch_size: 1,
        },
      },
    );
    const data = await readProviderJSON(response, siliconImageSchema);
    return downloadImage(data.images[0].url, env);
  }
  const model =
    provider.imageModel ||
    (provider.kind === "openrouter"
      ? AI_IMAGE_DEFAULTS.openrouterModel
      : env.IMAGE_MODEL || AI_IMAGE_DEFAULTS.openaiModel);
  const endpoint =
    provider.kind === "openrouter"
      ? AI_ENDPOINTS.openrouter.images
      : AI_ENDPOINTS.openai.images;
  const response = await providerRequest(endpoint, key, {
    timeoutMs,
    body: {
      model,
      prompt,
      n: 1,
      size: AI_IMAGE_DEFAULTS.size,
      ...(provider.kind === "openai" && model.startsWith("dall-e")
        ? { response_format: "b64_json" }
        : { output_format: "png" }),
    },
  });
  const data = await readProviderJSON(response, imageResponseSchema);
  return decodeImage(
    data.data[0].b64_json,
    data.data[0].media_type ?? "image/png",
  );
}
export async function generateImage(
  env: RuntimeEnv,
  input: z.infer<typeof imageInputSchema>,
) {
  const settings = await readSettings(env);
  let provider = input.providerId
    ? settings.providers.find((p) => p.id === input.providerId)
    : settings.providers.find(
        (p) => providerCapabilities(p, env).imageConfigured,
      );
  if (input.providerId && !provider)
    throw new AppError(
      422,
      "PROVIDER_NOT_FOUND",
      "Choose a configured image provider.",
    );
  if (!provider)
    provider = {
      id: "runtime-openai",
      name: "Runtime OpenAI",
      kind: "openai",
      model: "",
      temperature: AI_PARAMS.temperature.default,
      maxTokens: AI_PARAMS.maxTokens.default,
      configured: false,
    };
  const key =
    provider.kind === "openai"
      ? env.IMAGE_API_KEY || env.OPENAI_API_KEY
      : providerKey(provider, env);
  if (!key || !providerCapabilities(provider, env).imageConfigured)
    throw new AppError(
      503,
      "IMAGE_NOT_CONFIGURED",
      `The ${provider.kind} image service configuration is incomplete on the server.`,
    );
  if (!env.DB || !env.BUCKET)
    throw new AppError(
      503,
      "MEDIA_NOT_CONFIGURED",
      "Configure D1 and R2 before generating images.",
    );
  const payload = await generatePayload(
    env,
    provider,
    key,
    input.prompt,
    settings.limits.ai.requestTimeoutSeconds * 1000,
  );
  const ext =
    payload.mime === "image/jpeg" ? "jpg" : payload.mime.split("/")[1];
  return saveMedia(env, payload.bytes, {
    name: `generated-${Date.now()}.${ext}`,
    mime: payload.mime,
    postId: input.postId,
    source: "generated",
    prompt: input.prompt,
    policy: GENERATED_MEDIA_POLICY,
  });
}
