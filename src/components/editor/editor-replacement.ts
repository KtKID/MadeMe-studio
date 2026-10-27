import type { EditClock } from "./editor-state";

/** 只应用请求发出时作者同意替换的快照，迟到响应不得覆盖之后输入。 */
export function applyEditorReplacement(
  clock: EditClock,
  sequence: number,
  replace: () => void,
) {
  if (clock.snapshot() !== sequence) return false;
  replace();
  return true;
}
