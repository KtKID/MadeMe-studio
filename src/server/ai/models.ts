import type { Provider } from "../../shared/contracts";
import type { RuntimeEnv } from "../runtime";
import { AppError } from "../errors";
import { providerKey } from "../settings";
import { chatEndpoint } from "./text";
import { cloudflareBase, providerRequest, readProviderJSON } from "./transport";
import {
  cloudflareModelsSchema,
  geminiModelsSchema,
  standardModelsSchema,
} from "./protocols";
export async function listModels(env: RuntimeEnv, provider: Provider) {
  const key = providerKey(provider, env);
  if (!key)
    throw new AppError(
      503,
      "AI_NOT_CONFIGURED",
      "This provider key is not configured on the server.",
    );
  if (provider.kind === "gemini") {
    const response = await providerRequest(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=500",
      key,
      { google: true, timeoutMs: 15000 },
    );
    const data = await readProviderJSON(response, geminiModelsSchema);
    return data.models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .slice(0, 500)
      .map((m) => ({ id: m.name.replace(/^models\//, "") }));
  }
  if (provider.kind === "cloudflare") {
    const response = await providerRequest(
      `${cloudflareBase(env)}/models/search?per_page=100`,
      key,
      { timeoutMs: 15000 },
    );
    const data = await readProviderJSON(response, cloudflareModelsSchema);
    if (data.success === false)
      throw new AppError(
        502,
        "PROVIDER_ERROR",
        "Cloudflare did not return a model list.",
      );
    return data.result
      .filter((m) => m.name)
      .slice(0, 500)
      .map((m) => ({ id: m.name! }));
  }
  const response = await providerRequest(
    chatEndpoint(provider, env).replace(/chat\/completions$/, "models"),
    key,
    { timeoutMs: 15000 },
  );
  const data = await readProviderJSON(response, standardModelsSchema);
  return data.data.slice(0, 500).map((m) => ({ id: m.id }));
}
