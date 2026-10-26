import type { APIToken, TokenScope } from "../shared/contracts";
import type { RuntimeEnv } from "./runtime";
import { randomToken, sha256 } from "./auth/crypto";
export async function createToken(
  env: RuntimeEnv,
  input: { name: string; scopes: TokenScope[]; expiresInDays: number },
) {
  const token = randomToken();
  const now = new Date();
  const result: APIToken = {
    id: crypto.randomUUID(),
    name: input.name,
    scopes: [...new Set(input.scopes)],
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + input.expiresInDays * 86400000,
    ).toISOString(),
    lastUsedAt: null,
  };
  await env
    .DB!.prepare(
      "INSERT INTO api_tokens (id,name,token_hash,scopes_json,created_at,expires_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      result.id,
      result.name,
      await sha256(token),
      JSON.stringify(result.scopes),
      result.createdAt,
      result.expiresAt,
    )
    .run();
  return { token, ...result };
}
export async function listTokens(env: RuntimeEnv) {
  const rows = await env
    .DB!.prepare(
      "SELECT id,name,scopes_json,created_at,expires_at,last_used_at FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC",
    )
    .all<{
      id: string;
      name: string;
      scopes_json: string;
      created_at: string;
      expires_at: string;
      last_used_at: string | null;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    scopes: JSON.parse(r.scopes_json),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
  }));
}
export async function revokeToken(env: RuntimeEnv, id: string) {
  await env
    .DB!.prepare("UPDATE api_tokens SET revoked_at=? WHERE id=?")
    .bind(new Date().toISOString(), id)
    .run();
}
