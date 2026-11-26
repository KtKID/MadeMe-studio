/** 打开或列举 IndexedDB 的上限；超时必须失败，避免设置页一直转圈。 */
const DEFAULT_TIMEOUT_MS = 8_000;
let openTimeoutMs = DEFAULT_TIMEOUT_MS;
export function setIndexedDbOpenTimeoutForTests(ms?: number) {
  openTimeoutMs = ms === undefined ? DEFAULT_TIMEOUT_MS : ms;
}
export function indexedDbOpenTimeoutMs() {
  return openTimeoutMs;
}
