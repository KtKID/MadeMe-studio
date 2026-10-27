import { logCaught, logger, type RequestLogContext } from "./log";
import { ZodError, type ZodType } from "zod";
import { AppError } from "./errors";
export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export async function boundedBody(request: Request, max: number) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > max)
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function readJSON<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError(
      415,
      "JSON_REQUIRED",
      "Use Content-Type: application/json.",
    );
  const body = await boundedBody(request, 1_100_000);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    // 转为 400 INVALID_JSON，由 errorResponse 统一记录；原始异常只含请求体解析细节。
    throw new AppError(400, "INVALID_JSON", "The request is not valid JSON.");
  }
  return schema.parse(parsed);
}
/**
 * 将异常转换为公开错误响应，并统一写日志（不得静默）：
 * 预期的 4xx 只记录错误码（401/403/429 为 warn，其余 info）；ZodError 只记录字段路径；
 * 5xx 与意外异常记录为 error，并附带脱敏后的异常类型、消息与堆栈。
 */
export function errorResponse(
  error: unknown,
  context: Partial<RequestLogContext> = {},
) {
  if (error instanceof AppError) {
    const level =
      error.status >= 500
        ? "error"
        : [401, 403, 429].includes(error.status)
          ? "warn"
          : "info";
    if (level === "error") logCaught("request.app_error", error, context);
    else
      logger[level]("request.rejected", {
        ...context,
        status: error.status,
        code: error.code,
      });
  } else if (error instanceof ZodError)
    logger.info("request.rejected", {
      ...context,
      status: 422,
      code: "VALIDATION_ERROR",
      fields: error.issues.slice(0, 10).map((i) => i.path.join(".")),
    });
  else logCaught("request.unhandled_error", error, context);
  if (error instanceof AppError)
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      error.status,
    );
  if (error instanceof ZodError)
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the submitted fields.",
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
      },
      422,
    );
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed. Please try again.",
      },
    },
    500,
  );
}
