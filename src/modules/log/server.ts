/**
 * 统一服务端日志接口：每条日志是一行 JSON，经 console 输出，
 * 可直接被 Workers Logs（observability）与 `wrangler tail` 解析。
 *
 * 使用约定：
 * - 事件名用 `模块.动作_结果` 小写点分，例如 `auth.google.callback_failed`。
 * - 只放安全的上下文字段；所有字段都会经过 `redact` 强制脱敏，敏感键名整体替换。
 * - catch 块使用 `logCaught(event, error, fields)`，不得空 catch 或静默回退。
 * - 预期的 4xx 用 info/warn 且只记错误码；意外异常、5xx、上游失败用 error。
 */
import { redact, serializeError } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const sink: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export function log(level: LogLevel, event: string, fields: LogFields = {}) {
  try {
    const { error, ...rest } = fields;
    const record: Record<string, unknown> = {
      level,
      event,
      ts: new Date().toISOString(),
      ...(redact(rest) as Record<string, unknown>),
    };
    if (error !== undefined)
      record.error = serializeError(error, { stack: level === "error" });
    sink[level](JSON.stringify(record));
  } catch {
    // 日志失败不能影响业务响应；退化为固定文本，仍保留事件名便于定位。
    console.error(`{"level":"error","event":"log.write_failed"}`);
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => log("debug", event, fields),
  info: (event: string, fields?: LogFields) => log("info", event, fields),
  warn: (event: string, fields?: LogFields) => log("warn", event, fields),
  error: (event: string, fields?: LogFields) => log("error", event, fields),
};

/** catch 块专用：记录被捕获的异常（脱敏），默认 error 级别。 */
export function logCaught(
  event: string,
  error: unknown,
  fields: LogFields = {},
  level: LogLevel = "error",
) {
  log(level, event, { ...fields, error });
}

export type RequestLogContext = {
  requestId: string;
  method: string;
  /** 只记录路径，不记录查询串（回调查询串含 code/state）。 */
  path: string;
};

/** 请求关联：优先使用 Cloudflare 的 cf-ray，没有时生成随机 ID。 */
export function requestLogContext(request: Request): RequestLogContext {
  let path = "/";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "[invalid-url]";
  }
  const ray = request.headers.get("cf-ray");
  return {
    requestId:
      ray && /^[A-Za-z0-9-]{1,64}$/.test(ray) ? ray : crypto.randomUUID(),
    method: request.method,
    path,
  };
}
