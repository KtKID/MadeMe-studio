import { logCaught } from "../../modules/log/server";
import { googleAuthConfigured, handleGoogleLogout } from "./google";
import { z } from "zod";
import {
  authorPasswordConfigurationSchema,
  authLoginRequestSchema,
  authLoginResponseSchema,
  authLogoutResponseSchema,
  authSessionResponseSchema,
} from "../../shared/auth";
import { ownerAccount, ownerDisplayName } from "./account";
import { AppError } from "../errors";
import { boundedBody, json } from "../http";
import type { RuntimeEnv } from "../runtime";
import { rateLimit } from "../rate-limit";
import { constantTimeEqual, hmac, randomToken, sha256 } from "./crypto";
import { assertSameOrigin, authenticate, type Identity } from "./identity";
const HASH = /^pbkdf2-sha256:600000:([a-f0-9]{32}):([a-f0-9]{64})$/;
const COOKIE = "__Host-mm_author";
const LIFETIME = 8 * 60 * 60;
const encoder = new TextEncoder();
function hex(bytes: Uint8Array) {
  return [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  try {
    return hex(
      new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 },
          key,
          256,
        ),
      ),
    );
  } catch (error) {
    // 某些生产 Worker 限制迭代次数；不得降级哈希强度或回退为成功。
    logCaught("auth.password_kdf_unavailable", error);
    throw new AppError(
      503,
      "AUTH_KDF_UNAVAILABLE",
      "The deployment does not support the required password hashing policy.",
    );
  }
}
/** 仅供独立安全配置流程与隔离测试使用，不自动生成或写入真实凭据。 */
export async function hashAuthorPassword(password: string) {
  authorPasswordConfigurationSchema.parse(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256:600000:${hex(salt)}:${await derive(password, salt)}`;
}
export function passwordAuthConfigured(env: RuntimeEnv): boolean {
  return (
    env.AUTH_MODE === "password" &&
    !!env.DB &&
    z.email().safeParse(env.OWNER_EMAIL?.trim()).success &&
    HASH.test(env.AUTH_PASSWORD_HASH || "") &&
    (env.SESSION_SECRET?.length ?? 0) >= 32
  );
}
export function getAuthPresentation(
  env: RuntimeEnv,
  identity: Pick<Identity, "owner" | "displayName">,
) {
  const mode =
    env.AUTH_MODE === "google"
      ? "google"
      : env.AUTH_MODE === "password"
        ? "password"
        : env.AUTH_MODE === "sites"
          ? "sites"
          : "unconfigured";
  const configured =
    mode === "google"
      ? googleAuthConfigured(env)
      : mode === "password"
        ? passwordAuthConfigured(env)
        : mode === "sites" && !!(env.OWNER_ID || env.OWNER_EMAIL);
  const authenticated = configured && identity.owner;
  const account = authenticated ? ownerAccount(env, identity) : null;
  const accountName = authenticated ? ownerDisplayName(env, identity) : null;
  return authSessionResponseSchema.parse({
    mode,
    configured,
    authenticated,
    ...(account ? { account } : {}),
    ...(accountName ? { accountName } : {}),
  });
}
async function configVersion(env: RuntimeEnv) {
  return hmac(
    JSON.stringify([
      env.OWNER_EMAIL!.trim().toLowerCase(),
      env.AUTH_PASSWORD_HASH,
    ]),
    env.SESSION_SECRET!,
  );
}
function sessionToken(request: Request) {
  const pairs = (request.headers.get("cookie") || "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${COOKIE}=`));
  if (pairs.length !== 1) return null;
  const value = pairs[0].slice(COOKIE.length + 1);
  return /^mm_[a-f0-9]{64}$/.test(value) ? value : null;
}
export async function passwordSessionOwner(request: Request, env: RuntimeEnv) {
  if (
    !passwordAuthConfigured(env) ||
    new URL(request.url).protocol !== "https:"
  )
    return false;
  const token = sessionToken(request);
  if (!token) return false;
  const row = await env
    .DB!.prepare(
      "SELECT config_version, expires_at FROM author_sessions WHERE token_hash=? AND revoked_at IS NULL",
    )
    .bind(await sha256(token))
    .first<{ config_version: string; expires_at: number }>();
  return (
    !!row &&
    row.expires_at > Date.now() &&
    constantTimeEqual(row.config_version, await configVersion(env))
  );
}
function cookie(value: string, age: number) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
}
export async function handleAuth(
  request: Request,
  env: RuntimeEnv,
  action: string,
): Promise<Response> {
  if (action === "session" && request.method === "GET")
    return json(getAuthPresentation(env, await authenticate(request, env)));
  if (!["login", "logout"].includes(action) || request.method !== "POST")
    throw new AppError(404, "NOT_FOUND", "Not found.");
  // 浏览器登录端点不接受 API token 豁免；登录本身同样需要防止 CSRF。
  assertSameOrigin(request, {
    owner: false,
    trustedIdentity: null,
    scopes: [],
  });
  if (new URL(request.url).protocol !== "https:")
    throw new AppError(
      403,
      "HTTPS_REQUIRED",
      "HTTPS is required for author sign-in.",
    );
  if (env.AUTH_MODE === "google" && action === "logout")
    return handleGoogleLogout(request, env);
  if (!passwordAuthConfigured(env))
    throw new AppError(
      503,
      "AUTH_SETUP_REQUIRED",
      "Independent author authentication is not configured.",
    );
  const oldToken = sessionToken(request);
  if (action === "logout") {
    if (oldToken)
      await env
        .DB!.prepare(
          "UPDATE author_sessions SET revoked_at=? WHERE token_hash=?",
        )
        .bind(Date.now(), await sha256(oldToken))
        .run();
    return json(authLogoutResponseSchema.parse({ ok: true }), 200, {
      "Set-Cookie": cookie("", 0),
    });
  }
  // 单作者全局窗口：不信任可伪造 IP 头，避免换邮箱或 IP 绕过限制。
  await rateLimit(env, "author-login", 5, 300);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError(
      415,
      "JSON_REQUIRED",
      "Use Content-Type: application/json.",
    );
  const bytes = await boundedBody(request, 8192);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Invalid JSON.");
  }
  const input = authLoginRequestSchema.parse(raw);
  const match = HASH.exec(env.AUTH_PASSWORD_HASH!)!;
  const salt = Uint8Array.from(match[1].match(/../g)!, (v) => parseInt(v, 16));
  const derived = await derive(input.password, salt);
  const passwordOK = constantTimeEqual(derived, match[2]);
  const emailOK = constantTimeEqual(
    await sha256(input.email),
    await sha256(env.OWNER_EMAIL!.trim().toLowerCase()),
  );
  if (!passwordOK || !emailOK)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
    );
  const token = randomToken();
  const now = Date.now();
  const statements = [
    env
      .DB!.prepare(
        "DELETE FROM author_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL",
      )
      .bind(now),
  ];
  if (oldToken)
    statements.push(
      env
        .DB!.prepare(
          "UPDATE author_sessions SET revoked_at=? WHERE token_hash=?",
        )
        .bind(now, await sha256(oldToken)),
    );
  statements.push(
    env
      .DB!.prepare(
        "INSERT INTO author_sessions (token_hash,config_version,created_at,expires_at) VALUES (?,?,?,?)",
      )
      .bind(
        await sha256(token),
        await configVersion(env),
        now,
        now + LIFETIME * 1000,
      ),
  );
  await env.DB!.batch(statements);
  return json(
    authLoginResponseSchema.parse({ ok: true, returnTo: input.returnTo }),
    200,
    { "Set-Cookie": cookie(token, LIFETIME) },
  );
}
