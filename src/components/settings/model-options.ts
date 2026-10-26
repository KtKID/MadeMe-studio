import type { Provider } from "../../shared/contracts";
/** 服务商枚举以共享协议为准；这里只维护中文展示名称。 */
export const providerLabels: Record<Provider["kind"], string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  siliconflow: "SiliconFlow",
  cloudflare: "Cloudflare AI",
  gemini: "Google Gemini",
};
export function normalizeImageModel<T extends { imageModel?: string }>(
  value: T,
): T {
  const copy = { ...value };
  const imageModel = copy.imageModel?.trim();
  if (imageModel) copy.imageModel = imageModel;
  else delete copy.imageModel;
  return copy;
}
