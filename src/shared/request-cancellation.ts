/** 不依赖新版 AbortSignal 静态方法，兼容旧 Electron/WebView；只使用基本 AbortController。 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("操作已取消", "AbortError");
}

/** 每个请求独立计时并组合外部取消，完成后必须释放定时器及监听器。 */
export function requestCancellation(
  external: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort(external?.reason);
  if (external?.aborted) cancel();
  else external?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("请求等待超时", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener("abort", cancel);
    },
  };
}
