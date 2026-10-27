import type { Provider } from "../../shared/contracts";
import type { RuntimeEnv } from "../runtime";
export function providerKey(provider: Provider, env: RuntimeEnv) {
  return {
    openai: env.OPENAI_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    siliconflow: env.SILICONFLOW_API_KEY,
    cloudflare: env.CLOUDFLARE_AI_TOKEN,
    gemini: env.GEMINI_API_KEY,
  }[provider.kind];
}
/** 仅检查部署配置，不代表账户、额度或模型已联调通过。 */
export function providerCapabilities(provider: Provider, env: RuntimeEnv) {
  const accountConfigured =
    provider.kind !== "cloudflare" ||
    /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? "");
  return {
    textConfigured: accountConfigured && !!providerKey(provider, env),
    imageConfigured:
      accountConfigured &&
      !!(provider.kind === "openai"
        ? env.IMAGE_API_KEY || env.OPENAI_API_KEY
        : providerKey(provider, env)),
  };
}
