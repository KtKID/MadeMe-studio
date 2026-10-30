/** 错误使用固定安全文案；不返回上游正文、路径、Prompt 或账户资料。 */
export class HarnessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function safeError(error: unknown) {
  return error instanceof HarnessError
    ? error
    : new HarnessError("HARNESS_UNAVAILABLE", "本地 Codex 服务暂不可用。", 503);
}
