import { googleAuthConfigured, googleSession } from "./google";
import type { TokenScope } from "../../shared/contracts";
import type { RuntimeEnv } from "../runtime";
import { AppError } from "../errors";
import { sha256 } from "./crypto";
import { passwordAuthConfigured, passwordSessionOwner } from "./password";
export type Identity = {
  owner: boolean;
  trustedIdentity: string | null;
  tokenId?: string;
  scopes: TokenScope[];
  /** 仅 Google 作者会话：登录时记录的已清洗昵称；仅用于作者本人界面。 */
  displayName?: string | null;
};
export function trustedIdentity(
  request: Request,
  env: RuntimeEnv,
): string | null {
  if (["password", "google"].includes(env.AUTH_MODE || "")) return null;
  const host = new URL(request.url).hostname;
  if (
    env.ENVIRONMENT === "development" &&
    env.ALLOW_LOCAL_DEV_IDENTITY === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host)
  )
    return env.DEV_OWNER_ID || null;
  // 仅用于会清除外部同名头部的 Sites 可信分发器，不能直接暴露 Worker 入口。
  if (env.AUTH_MODE !== "sites") return null;
  return request.headers.get("oai-authenticated-user-id") || null;
}
export function ownerConfigured(env: RuntimeEnv) {
  if (env.AUTH_MODE === "google") return googleAuthConfigured(env);
  if (env.AUTH_MODE === "password") return passwordAuthConfigured(env);
  return !!env.OWNER_ID || (env.AUTH_MODE === "sites" && !!env.OWNER_EMAIL);
}
export async function authenticate(
  request: Request,
  env: RuntimeEnv,
): Promise<Identity> {
  const id = trustedIdentity(request, env);
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  const owner =
    !!id &&
    (env.OWNER_ID
      ? id === env.OWNER_ID
      : env.AUTH_MODE === "sites" &&
        !!env.OWNER_EMAIL &&
        email === env.OWNER_EMAIL.trim().toLowerCase());
  const base: Identity = { owner, trustedIdentity: id, scopes: [] };
  const auth = request.headers.get("authorization");
  if (!auth) {
    if (env.AUTH_MODE === "google") {
      const session = await googleSession(request, env);
      return {
        owner: !!session,
        trustedIdentity: null,
        scopes: [],
        displayName: session?.displayName ?? null,
      };
    }
    return env.AUTH_MODE === "password"
      ? {
          owner: await passwordSessionOwner(request, env),
          trustedIdentity: null,
          scopes: [],
        }
      : base;
  }
  if (!auth.startsWith("Bearer ") || !env.DB)
    throw new AppError(401, "INVALID_TOKEN", "Invalid API token.");
  const token = auth.slice(7);
  if (!/^mm_[a-f0-9]{64}$/.test(token))
    throw new AppError(401, "INVALID_TOKEN", "Invalid API token.");
  const row = await env.DB.prepare(
    "SELECT id, scopes_json, expires_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(await sha256(token))
    .first<{ id: string; scopes_json: string; expires_at: string }>();
  if (!row || row.expires_at <= new Date().toISOString())
    throw new AppError(401, "INVALID_TOKEN", "Invalid or expired API token.");
  await env.DB.prepare("UPDATE api_tokens SET last_used_at=? WHERE id=?")
    .bind(new Date().toISOString(), row.id)
    .run();
  return {
    owner: false,
    trustedIdentity: null,
    tokenId: row.id,
    scopes: JSON.parse(row.scopes_json),
  };
}
export function requireOwner(identity: Identity, env: RuntimeEnv) {
  if (!ownerConfigured(env))
    throw new AppError(
      503,
      "OWNER_SETUP_REQUIRED",
      "Owner identity has not been configured.",
    );
  if (!identity.owner)
    throw new AppError(
      identity.tokenId ? 403 : 401,
      "UNAUTHORIZED",
      "Owner sign-in is required.",
    );
}
export function requireScope(
  identity: Identity,
  env: RuntimeEnv,
  scope: TokenScope,
) {
  if (!ownerConfigured(env)) requireOwner(identity, env);
  if (identity.owner) return;
  if (identity.tokenId) {
    if (identity.scopes.includes(scope)) return;
    throw new AppError(
      403,
      "INSUFFICIENT_SCOPE",
      `The API token requires the ${scope} scope.`,
    );
  }
  requireOwner(identity, env);
}
export function assertSameOrigin(request: Request, identity: Identity) {
  if (identity.tokenId) return;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new AppError(
      403,
      "CSRF_REJECTED",
      "A same-origin request is required.",
    );
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new AppError(
      403,
      "CSRF_REJECTED",
      "Cross-site writes are not allowed.",
    );
}
