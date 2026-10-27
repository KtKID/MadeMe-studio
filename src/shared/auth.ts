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
  /** Google 昵称（ID token `name`，已清洗）；仅 Google 作者本人且会话已记录时出现。 */
  accountName: z.string().min(1).max(64).optional(),
});
/** 侧边栏头像字母：取首个字母或数字（支持中文等 Unicode 字母），缺省为 "A"。 */
export function accountInitial(account: string | null | undefined): string {
  const match = account?.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "A";
}
/** 侧栏显示：Google 昵称优先，回退邮箱；悬停提示带邮箱以区分同名账号。 */
export function accountPresentation(
  name: string | null | undefined,
  email: string | null | undefined,
): { label: string; title: string } | null {
  const label = name || email;
  if (!label) return null;
  const who = name && email ? `${name}（${email}）` : label;
  return { label, title: `已登录：${who}（账号与退出）` };
}
export const DISPLAY_NAME_MAX = 64;
/**
 * 清洗外部提供的显示名（Google `name` 声明）：非字符串/空白返回 null；
 * NFC 规范化，移除控制字符、格式字符（含双向覆盖、零宽字符），折叠空白，
 * 按码点截断到 64。React/Astro 输出时仍会转义，此处防止视觉欺骗与超长存储。
 */
export function sanitizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .slice(0, 1024)
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX).join("").trim() || null;
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
  /** 需 `profile` scope；可缺失或异常，异常时忽略而不阻止登录，由 sanitizeDisplayName 清洗。 */
  name: z.unknown().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});
