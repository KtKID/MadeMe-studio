import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import type { RuntimeEnv } from "./server/runtime";
import { secureResponse } from "./server/response-policy";
import {
  configureLogLevel,
  logCaught,
  requestLogContext,
} from "./modules/log/server";

export const onRequest = defineMiddleware(async (context, next) => {
  // 运行时依赖由入口注入，领域逻辑不直接依赖 Cloudflare 模块。
  (context.locals as unknown as Record<string, unknown>).env = env;
  configureLogLevel((env as RuntimeEnv).LOG_LEVEL);
  let response: Response;
  try {
    response = await next();
  } catch (error) {
    // 页面渲染或路由抛出的未处理异常：记录后交回 Astro/Workers 的默认 500 处理。
    logCaught(
      "request.unhandled_exception",
      error,
      requestLogContext(context.request),
    );
    throw error;
  }
  return secureResponse(response, context.url, (env as RuntimeEnv).AUTH_MODE);
});
