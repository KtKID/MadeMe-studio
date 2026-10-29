import type { Settings } from "../../shared/contracts";
import {
  DEFAULT_CONFIG,
  type ConfigGroup,
  type RuntimeConfig,
  type RuntimeConfigPatch,
} from "../../modules/config";
function equal(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}
export type SettingsPatch = Omit<
  Partial<Settings>,
  "limits" | "articleTypes"
> & {
  limits?: RuntimeConfigPatch;
};
/**
 * 配置项（settings.limits）按叶子字段比较：只发改动的项；改回默认值时发送 null，
 * 服务端 JSON merge patch 会删除该键，D1 里只保留“作者改过且不同于默认”的配置。
 */
export function limitsPatch(
  baseline: RuntimeConfig | undefined,
  current: RuntimeConfig | undefined,
): RuntimeConfigPatch | undefined {
  if (!current) return undefined;
  const patch: Record<string, Record<string, unknown>> = {};
  for (const group of Object.keys(current) as ConfigGroup[]) {
    const values = current[group] as Record<string, unknown>;
    const before = (baseline?.[group] ?? {}) as Record<string, unknown>;
    const defaults = DEFAULT_CONFIG[group] as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      if (equal(value, before[key])) continue;
      (patch[group] ??= {})[key] = equal(value, defaults[key]) ? null : value;
    }
  }
  return Object.keys(patch).length ? (patch as RuntimeConfigPatch) : undefined;
}
/** 只发送当前窗口实际改变的字段，避免旧表单覆盖其他窗口的独立设置。 */
export function settingsPatch(
  baseline: Settings,
  current: Settings,
): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof Settings)[]) {
    // 类型由独立原子接口立即保存，不能被旧设置表单覆盖。
    if (key === "articleTypes") continue;
    if (key === "limits") {
      const limits = limitsPatch(baseline.limits, current.limits);
      if (limits) patch.limits = limits;
      continue;
    }
    if (!equal(current[key], baseline[key])) patch[key] = current[key];
  }
  return patch as SettingsPatch;
}
/** 响应只替换请求后没有再修改的字段；后续本地输入继续保留且仍为脏状态。 */
export function reconcileSettingsResponse(
  submitted: Settings,
  current: Settings,
  response: Settings,
  discardedBaseline?: Settings,
): Settings {
  // 放弃本身不是编辑；但放弃后返回面板输入的新草稿仍必须保留。
  const comparison = discardedBaseline ?? submitted;
  const merged: Record<string, unknown> = { ...response };
  for (const key of Object.keys(current) as (keyof Settings)[]) {
    if (!equal(current[key], comparison[key])) merged[key] = current[key];
  }
  return merged as Settings;
}
