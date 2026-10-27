import { z } from "zod";
/** 仅接受本站路径；拒绝编码分隔符、反斜线及控制字符，避免开放重定向。 */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]|%/i.test(value)
  )
    return "/studio";
  const url = new URL(value, "https://local.invalid");
  return url.origin === "https://local.invalid"
    ? url.pathname + url.search + url.hash
    : "/studio";
}
export const authLoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(1024),
    returnTo: z.string().max(2048).optional().transform(safeReturnTo),
  })
  .strict();
export const authSessionResponseSchema = z.object({
  mode: z.enum(["sites", "password", "unconfigured"]),
  configured: z.boolean(),
  authenticated: z.boolean(),
});
export const authLoginResponseSchema = z.object({
  ok: z.literal(true),
  returnTo: z.string(),
});
export const authLogoutResponseSchema = z.object({ ok: z.literal(true) });

/** 无 MFA 的独立作者新凭据采用长口令；登录本身不据此透露凭据策略。 */
export const authorPasswordConfigurationSchema = z.string().min(15).max(1024);
