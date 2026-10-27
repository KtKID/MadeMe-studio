import { providerCapabilities } from "./capabilities";
import { z } from "zod";
import { imageInputSchema, type Provider } from "../../shared/contracts";
import type { RuntimeEnv } from "../runtime";
import { AppError } from "../errors";
import { logCaught, logger } from "../log";
import { providerKey, readSettings } from "../settings";
import { saveMedia, validateMedia } from "../media/service";
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
  validateMedia(bytes, actual);
  return { bytes, mime: actual };
}
function safeDownloadURL(value: string, env: RuntimeEnv) {
  const hosts = new Set(["sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com"]);
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
      signal: AbortSignal.timeout(30000),
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
  const bytes = await readProviderBytes(response, 25 * 1024 * 1024);
  const mime = mimeFromBytes(bytes);
  validateMedia(bytes, mime);
  return { bytes, mime };
}
async function generatePayload(
  env: RuntimeEnv,
  provider: Provider,
  key: string,
  prompt: string,
): Promise<ImagePayload> {
  if (provider.kind === "gemini") {
    const model = provider.imageModel || "gemini-2.5-flash-image";
    const response = await providerRequest(geminiURL(model), key, {
      google: true,
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
    const model = provider.imageModel || "@cf/black-forest-labs/flux-1-schnell";
    if (!/^@(cf|hf)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model))
      throw new AppError(
        422,
        "INVALID_MODEL",
        "Choose a valid Cloudflare image model ID.",
      );
    if (prompt.length > 2048)
      throw new AppError(
        422,
        "IMAGE_PROMPT_TOO_LONG",
        "Cloudflare image prompts support at most 2048 characters.",
      );
    const response = await providerRequest(
      `${cloudflareBase(env)}/run/${model}`,
      key,
      { body: { prompt } },
    );
    if (response.headers.get("content-type")?.startsWith("image/")) {
      const bytes = await readProviderBytes(response, 25 * 1024 * 1024);
      const mime = mimeFromBytes(bytes);
      validateMedia(bytes, mime);
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
      "https://api.siliconflow.cn/v1/images/generations",
      key,
      {
        body: {
          model: provider.imageModel || "black-forest-labs/FLUX.1-schnell",
          prompt,
          image_size: "1024x1024",
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
      ? "google/gemini-2.5-flash-image"
      : env.IMAGE_MODEL || "gpt-image-2");
  const endpoint =
    provider.kind === "openrouter"
      ? "https://openrouter.ai/api/v1/images"
      : "https://api.openai.com/v1/images/generations";
  const response = await providerRequest(endpoint, key, {
    body: {
      model,
      prompt,
      n: 1,
      size: "1024x1024",
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
      temperature: 0.7,
      maxTokens: 2048,
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
  const payload = await generatePayload(env, provider, key, input.prompt);
  const ext =
    payload.mime === "image/jpeg" ? "jpg" : payload.mime.split("/")[1];
  return saveMedia(env, payload.bytes, {
    name: `generated-${Date.now()}.${ext}`,
    mime: payload.mime,
    postId: input.postId,
    source: "generated",
    prompt: input.prompt,
  });
}
