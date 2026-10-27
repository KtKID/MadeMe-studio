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
  mode: z.enum(["sites", "password", "google", "unconfigured"]),
  configured: z.boolean(),
  authenticated: z.boolean(),
  /** 仅在已验证作者本人的会话中出现；未登录时不返回该字段。 */
  account: z.email().max(254).optional(),
});
/** 侧边栏头像字母：取账号首个字母或数字，缺省为 "A"。 */
export function accountInitial(account: string | null | undefined): string {
  const match = account?.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "A";
}
export const authLoginResponseSchema = z.object({
  ok: z.literal(true),
  returnTo: z.string(),
});
export const authLogoutResponseSchema = z.object({ ok: z.literal(true) });

/** 无 MFA 的独立作者新凭据采用长口令；登录本身不据此透露凭据策略。 */
export const authorPasswordConfigurationSchema = z.string().min(15).max(1024);

/** Google OAuth 的应用输入和固定失败代码；不接受客户端指定提供方或回调地址。 */
export const googleStartRequestSchema = z
  .object({
    returnTo: z.string().max(2048).optional().transform(safeReturnTo),
  })
  .strict();
export const googleLoginErrorSchema = z.enum([
  "google_failed",
  "google_denied",
]);
export const googleIdentityClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string().min(1).max(256),
  azp: z.string().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});
