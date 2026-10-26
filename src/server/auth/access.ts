import type { RuntimeEnv } from "../runtime";
import type { StoredPost } from "../content/repository";
import type { Identity } from "./identity";
import { constantTimeEqual, hmac, sha256 } from "./crypto";
import { AppError } from "../errors";
export function accessCookieName(id: string) {
  return `mm_access_${id.replace(/[^a-zA-Z0-9]/g, "")}`;
}
function cookieValue(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export async function hasPasswordAccess(
  request: Request,
  env: RuntimeEnv,
  row: StoredPost,
) {
  if (!env.SESSION_SECRET || !row.publishedPasswordHash) return false;
  const value = cookieValue(request, accessCookieName(row.draft.id));
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (
    !expires ||
    !signature ||
    !/^\d+$/.test(expires) ||
    Number(expires) < Date.now()
  )
    return false;
  const message = `${row.draft.id}:${expires}:${await sha256(row.publishedPasswordHash)}`;
  return constantTimeEqual(signature, await hmac(message, env.SESSION_SECRET));
}
export async function canReadPost(
  request: Request,
  env: RuntimeEnv,
  identity: Identity,
  row: StoredPost,
) {
  if (identity.owner) return true;
  if (row.draft.deletedAt || !row.published) return false;
  if (
    row.published.visibility === "public" ||
    row.published.visibility === "unlisted"
  )
    return true;
  if (row.published.visibility === "password")
    return hasPasswordAccess(request, env, row);
  return false;
}
export async function makeAccessCookie(
  request: Request,
  env: RuntimeEnv,
  row: StoredPost,
) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new AppError(
      503,
      "SESSION_SETUP_REQUIRED",
      "Password access requires a securely configured session secret.",
    );
  const expires = String(Date.now() + 3600_000);
  const signature = await hmac(
    `${row.draft.id}:${expires}:${await sha256(row.publishedPasswordHash!)}`,
    env.SESSION_SECRET,
  );
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${accessCookieName(row.draft.id)}=${expires}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}`;
}
