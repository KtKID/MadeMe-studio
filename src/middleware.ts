import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
export const onRequest = defineMiddleware(async (context, next) => {
  (context.locals as unknown as Record<string, unknown>).env = env;
  const response = await next();
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  return response;
});
