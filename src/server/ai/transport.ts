import { z } from "zod";
import { AppError } from "../errors";
import type { RuntimeEnv } from "../runtime";

const providerHosts = new Set([
  "api.openai.com",
  "openrouter.ai",
  "api.siliconflow.cn",
  "api.cloudflare.com",
  "generativelanguage.googleapis.com",
]);
/** 模型端点仅来自代码内官方白名单，任何调用都禁止携带凭据重定向。 */
export async function providerRequest(
  url: string,
  key: string,
  options: { body?: unknown; google?: boolean; timeoutMs?: number } = {},
) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !providerHosts.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw new AppError(
      422,
      "UNSAFE_PROVIDER_URL",
      "The provider endpoint is not permitted.",
    );
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        ...(options.google
          ? { "x-goog-api-key": key }
          : { Authorization: `Bearer ${key}` }),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
    });
  } catch {
    throw new AppError(
      502,
      "PROVIDER_UNAVAILABLE",
      "The provider could not be reached. Please try again.",
    );
  }
  if (!response.ok)
    throw new AppError(
      response.status === 429 ? 429 : 502,
      "PROVIDER_ERROR",
      response.status === 429
        ? "The provider rate limit was reached."
        : "The provider rejected the request. Check the server-side key and selected model.",
    );
  return response;
}
export async function readProviderBytes(response: Response, max = 35_000_000) {
  if (Number(response.headers.get("content-length") ?? 0) > max)
    throw new AppError(
      502,
      "PROVIDER_RESPONSE_TOO_LARGE",
      "The provider response exceeds the limit.",
    );
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(
        502,
        "PROVIDER_RESPONSE_TOO_LARGE",
        "The provider response exceeds the limit.",
      );
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
export async function readProviderJSON<T>(
  response: Response,
  schema: z.ZodType<T>,
) {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder().decode(await readProviderBytes(response)),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "INVALID_PROVIDER_RESPONSE",
      "The provider did not return valid JSON.",
    );
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      502,
      "INVALID_PROVIDER_RESPONSE",
      "The provider response did not match the expected protocol.",
    );
  return result.data;
}
export function cloudflareBase(env: RuntimeEnv) {
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
    throw new AppError(
      503,
      "AI_NOT_CONFIGURED",
      "A valid Cloudflare account ID must be securely configured.",
    );
  return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai`;
}
export function geminiURL(model: string) {
  const name = model.replace(/^models\//, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(name))
    throw new AppError(422, "INVALID_MODEL", "Choose a valid Gemini model ID.");
  return `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`;
}
