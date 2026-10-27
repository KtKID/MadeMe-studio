/**
 * 服务端与浏览器日志共用的脱敏规则。日志只用于排障，绝不能成为凭据或个人信息的泄露面。
 * 规则：敏感键名整体替换；任意字符串值再做模式擦除；深度、数组长度与字符串长度都有上限。
 */
export const REDACTED = "[REDACTED]";

// 键名命中即整体替换（大小写不敏感）。`stage`、`status`、`event` 等诊断字段不会命中。
const SENSITIVE_KEY =
  /secret|token|passw|authorization|cookie|^code$|auth_?code|state$|^state|nonce|verifier|challenge|session|api_?key|apikey|credential|private|signature|email|^body$|^raw|response_?body|provider_?body|^sub$|ticket|jwt|bearer|hash/i;

// AppError / jose 等错误码是固定大写常量，可安全记录；OAuth 授权码等任意值不匹配此格式。
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

const PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[JWT]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]"],
  [
    /([?&#](?:code|state|nonce|token|access_token|id_token|key|code_verifier|session)=)[^&#\s"']*/gi,
    "$1[REDACTED]",
  ],
  [/\b(?:mm|sk|pk|ghp|gho|xox[abp])_[A-Za-z0-9_-]{8,}/g, "[TOKEN]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[HEX]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[OPAQUE]"],
];

export function scrubString(value: string, max = 500): string {
  let out = value;
  for (const [pattern, replacement] of PATTERNS)
    out = out.replace(pattern, replacement);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redact(value: unknown, depth = 0, key = ""): unknown {
  if (key && isSensitiveKey(key)) {
    if (
      /^code$/i.test(key) &&
      typeof value === "string" &&
      SAFE_CODE.test(value)
    )
      return value;
    return value === undefined || value === null ? value : REDACTED;
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return `[${typeof value}]`;
  if (depth >= 4) return "[Truncated]";
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value))
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  // Request/Response/Headers 等运行时对象可能携带 Cookie 或正文，不展开。
  if (
    (typeof Request !== "undefined" && value instanceof Request) ||
    (typeof Response !== "undefined" && value instanceof Response) ||
    (typeof Headers !== "undefined" && value instanceof Headers)
  )
    return `[${value.constructor.name}]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(
    0,
    40,
  ))
    out[k] = redact(v, depth + 1, k);
  return out;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  status?: number;
  stack?: string;
  cause?: SerializedError | string;
}

/** 只保留类型、已擦除的消息、固定错误码与状态码；绝不展开 details 或上游正文。 */
export function serializeError(
  error: unknown,
  options: { stack?: boolean } = {},
  depth = 0,
): SerializedError {
  if (!(error instanceof Error))
    return {
      name: typeof error,
      message: scrubString(
        typeof error === "string" ? error : safeStringify(error),
        200,
      ),
    };
  const e = error as Error & { code?: unknown; status?: unknown };
  const out: SerializedError = {
    name: scrubString(e.name || "Error", 80),
    message: scrubString(e.message ?? "", 300),
  };
  if (typeof e.code === "string" && SAFE_CODE.test(e.code)) out.code = e.code;
  if (typeof e.status === "number") out.status = e.status;
  if (options.stack && e.stack) out.stack = scrubString(e.stack, 1500);
  if (e.cause !== undefined && depth < 2)
    out.cause = serializeError(e.cause, {}, depth + 1);
  return out;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(redact(value)) ?? String(value);
  } catch {
    // 循环引用等无法序列化的值只记录类型，不能让日志本身抛错。
    return `[${typeof value}]`;
  }
}
