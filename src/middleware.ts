import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import type { RuntimeEnv } from "./server/runtime";
import { secureResponse } from "./server/response-policy";

export const onRequest = defineMiddleware(async (context, next) => {
  // 运行时依赖由入口注入，领域逻辑不直接依赖 Cloudflare 模块。
  (context.locals as unknown as Record<string, unknown>).env = env;
  return secureResponse(
    await next(),
    context.url,
    (env as RuntimeEnv).AUTH_MODE,
  );
});
