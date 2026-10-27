/**
 * 浏览器端统一日志：只写入开发者控制台，不上报任何外部服务。
 * 被捕获后转换为界面提示的异常也必须经此记录，避免失败静默。
 */
import { redact, serializeError } from "./redact";

export type ClientLogLevel = "debug" | "info" | "warn" | "error";

export function clientLog(
  level: ClientLogLevel,
  event: string,
  fields: Record<string, unknown> = {},
) {
  try {
    const { error, ...rest } = fields;
    const record: Record<string, unknown> = {
      event,
      ...(redact(rest) as Record<string, unknown>),
    };
    if (error !== undefined) record.error = serializeError(error);
    const write =
      level === "debug"
        ? console.debug
        : level === "info"
          ? console.info
          : level === "warn"
            ? console.warn
            : console.error;
    write.call(console, "[mademe]", record);
  } catch {
    // 控制台不可用时不影响界面。
  }
}

export function clientCaught(
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {},
  level: ClientLogLevel = "warn",
) {
  clientLog(level, event, { ...fields, error });
}
