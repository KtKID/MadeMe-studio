import { aiActionSchema, type Provider } from "../../shared/contracts";
/** 服务商枚举以共享协议为准；这里只维护中文展示名称。 */
export const providerLabels: Record<Provider["kind"], string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  siliconflow: "SiliconFlow",
  cloudflare: "Cloudflare AI",
  gemini: "Google Gemini",
};
/** 设置页服务商下拉选项；顺序与 providerLabels 一致。 */
export const providerOptions = Object.entries(providerLabels).map(
  ([value, label]) => ({ value, label }),
);
/** 正文字体下拉选项；值为 Settings["font"]，文案与原 select 一致。 */
export const fontOptions = [
  { value: "yahei", label: "微软雅黑（默认系统字体）" },
  { value: "sans", label: "系统无衬线" },
  { value: "serif", label: "经典衬线" },
  { value: "mono", label: "利落等宽" },
];
/** 提示词动作下拉选项；以共享 Zod 枚举为准，值与显示文本均为原值，保持原 select 行为。 */
export const promptActionOptions = aiActionSchema.options.map((value) => ({
  value,
  label: value,
}));
export function normalizeImageModel<T extends { imageModel?: string }>(
  value: T,
): T {
  const copy = { ...value };
  const imageModel = copy.imageModel?.trim();
  if (imageModel) copy.imageModel = imageModel;
  else delete copy.imageModel;
  return copy;
}
