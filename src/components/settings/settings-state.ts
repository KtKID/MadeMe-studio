import type { Settings } from "../../shared/contracts";
function equal(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}
/** 只发送当前窗口实际改变的字段，避免旧表单覆盖其他窗口的独立设置。 */
export function settingsPatch(
  baseline: Settings,
  current: Settings,
): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof Settings)[]) {
    if (!equal(current[key], baseline[key])) patch[key] = current[key];
  }
  return patch as Partial<Settings>;
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
