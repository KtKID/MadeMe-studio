import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import type { RuntimeEnv } from "./server/runtime";
import { secureResponse } from "./server/response-policy";
import { buildPageViewEvent, recordPageViewSafely } from "./server/page-views";
import {
  configureLogLevel,
  logCaught,
  requestLogContext,
} from "./modules/log/server";

export const onRequest = defineMiddleware(async (context, next) => {
  // 运行时依赖由入口注入，领域逻辑不直接依赖 Cloudflare 模块。
  (context.locals as unknown as Record<string, unknown>).env = env;
  configureLogLevel((env as RuntimeEnv).LOG_LEVEL);
  const startedAt = Date.now();
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
  // 文章页在渲染时对可计数访问标记 pageView；此处补齐状态码与耗时后落库，失败只写日志。
  const locals = context.locals as unknown as { pageView?: { path: string } };
  if (locals.pageView && context.request.method === "GET") {
    await recordPageViewSafely(
      env as RuntimeEnv,
      buildPageViewEvent(
        context.request,
        response,
        startedAt,
        locals.pageView.path,
      ),
    );
  }
  return secureResponse(response, context.url, (env as RuntimeEnv).AUTH_MODE);
});
