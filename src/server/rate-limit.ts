import type { RuntimeEnv } from "./runtime";
import { AppError } from "./errors";
export async function rateLimit(
  env: RuntimeEnv,
  key: string,
  limit: number,
  windowSeconds = 60,
) {
  if (!env.DB)
    throw new AppError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "D1 storage is not configured.",
    );
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / windowSeconds) * windowSeconds;
  await env.DB.prepare(
    "INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start",
  )
    .bind(key, window)
    .run();
  const result = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE key=? AND window_start=?",
  )
    .bind(key, window)
    .first<{ count: number }>();
  if ((result?.count ?? 0) > limit)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please wait and try again.",
    );
}
