/** 外观的三个维度独立传递，避免换皮肤时意外覆盖明暗或字体。 */
export type Appearance = {
  mode: "light" | "dark" | "system";
  skin: "amber" | "sage" | "rose" | "ocean" | "mono";
  font: "yahei" | "sans" | "serif" | "mono";
};
export const fontStacks = {
  yahei: "'Microsoft YaHei','微软雅黑','PingFang SC',system-ui,sans-serif",
  sans: "'Microsoft YaHei','微软雅黑','PingFang SC',system-ui,sans-serif",
  serif: "'Songti SC','Noto Serif CJK SC','SimSun',Georgia,serif",
  mono: "'Cascadia Code','SFMono-Regular',Consolas,monospace",
} as const;
export function resolveMode(
  mode: Appearance["mode"],
  systemDark: boolean,
): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}
export function appearanceAttributes(appearance: Appearance) {
  return {
    "data-mode": appearance.mode,
    "data-skin": appearance.skin,
    "data-font": appearance.font,
  };
}
export function updateAppearance<T extends Appearance>(
  current: T,
  patch: Partial<Appearance>,
): T {
  return { ...current, ...patch };
}
/** null 表示使用皮肤默认色，只有显式的安全自定义值才写入行内覆盖。 */
export function accentOverrideStyle(
  accent: string | null | undefined,
): string | undefined {
  return typeof accent === "string" && /^#[0-9a-fA-F]{6}$/.test(accent)
    ? `--accent:${accent}`
    : undefined;
}
