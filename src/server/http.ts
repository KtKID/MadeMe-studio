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
    throw new AppError(400, "INVALID_JSON", "The request is not valid JSON.");
  }
  return schema.parse(parsed);
}
export function errorResponse(error: unknown) {
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
