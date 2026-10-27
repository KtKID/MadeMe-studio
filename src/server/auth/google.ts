import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";
import {
  googleIdentityClaimsSchema,
  googleStartRequestSchema,
} from "../../shared/auth";
import { AppError } from "../errors";
import { logger, requestLogContext } from "../../modules/log/server";
import { boundedBody, json } from "../http";
import { rateLimit } from "../rate-limit";
import type { RuntimeEnv } from "../runtime";
import { constantTimeEqual, hmac, randomToken, sha256 } from "./crypto";
import { assertSameOrigin } from "./identity";
const AUTHORIZATION = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const CALLBACK = "/api/auth/google/callback";
const FLOW_COOKIE = "__Host-mm_google_oauth";
const SESSION_COOKIE = "__Host-mm_google_author";
const FLOW_SECONDS = 600;
const SESSION_SECONDS = 8 * 60 * 60;
const opaque = /^mm_[a-f0-9]{64}$/;
function validOrigin(value?: string): boolean {
  try {
    const u = new URL(value!);
    return (
      u.protocol === "https:" &&
      u.origin === value &&
      !u.username &&
      !u.password
    );
  } catch {
    // 判定函数：无效配置即"未配置"，由调用方返回 503 AUTH_SETUP_REQUIRED 并经 errorResponse 记录。
    return false;
  }
}
export function googleAuthConfigured(env: RuntimeEnv): boolean {
  return (
    env.AUTH_MODE === "google" &&
    !!env.DB &&
    validOrigin(env.APP_ORIGIN) &&
    z.email().safeParse(env.OWNER_EMAIL?.trim()).success &&
    (/^[^@]+@gmail\.com$/i.test(env.OWNER_EMAIL?.trim() || "") ||
      !!env.OWNER_GOOGLE_SUB) &&
    !!env.GOOGLE_CLIENT_ID?.match(
      /^[a-zA-Z0-9._-]{1,256}\.apps\.googleusercontent\.com$/,
    ) &&
    !!env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_CLIENT_SECRET.length <= 4096 &&
    (env.SESSION_SECRET?.length ?? 0) >= 32 &&
    (env.OWNER_GOOGLE_SUB === undefined ||
      /^[a-zA-Z0-9_-]{1,255}$/.test(env.OWNER_GOOGLE_SUB))
  );
}
function configured(env: RuntimeEnv) {
  if (!googleAuthConfigured(env))
    throw new AppError(
      503,
      "AUTH_SETUP_REQUIRED",
      "Google author authentication is not configured.",
    );
}
async function version(env: RuntimeEnv) {
  return hmac(
    JSON.stringify([
      "google",
      env.APP_ORIGIN,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.OWNER_EMAIL!.trim().toLowerCase(),
      env.OWNER_GOOGLE_SUB ?? null,
    ]),
    env.SESSION_SECRET!,
  );
}
function readCookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") || "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return opaque.test(value) ? value : null;
}
function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}
function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
function checkOrigin(request: Request, env: RuntimeEnv) {
  if (new URL(request.url).origin !== env.APP_ORIGIN)
    throw new AppError(
      403,
      "AUTH_ORIGIN_REJECTED",
      "Use the configured HTTPS origin.",
    );
}
/**
 * 请求和响应读取均受超时约束；地址只来自模块常量，禁止重定向到其他主机。
 * Workers 的 fetch 只支持 redirect "follow" | "manual"（"error" 会直接抛 TypeError），
 * 因此使用 "manual"，并把任何非 2xx（含 3xx 重定向）都视为失败。
 */
async function providerJSON(
  url: typeof TOKEN | typeof JWKS,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let status: number | undefined;
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    status = response.status;
    if (response.status < 200 || response.status >= 300)
      throw new Error("provider unavailable");
    const bytes = await boundedBody(response as unknown as Request, 65536);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    // 只记录端点名、HTTP 状态与异常类型；不记录请求体（含 code/verifier/secret）或提供方响应正文。
    logger.warn("auth.google.provider_failed", {
      endpoint: url === TOKEN ? "token" : "jwks",
      httpStatus: status,
      errorName: error instanceof Error ? error.name : typeof error,
      timedOut: controller.signal.aborted,
    });
    throw new AppError(
      503,
      "GOOGLE_UNAVAILABLE",
      "Google sign-in is temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
type Flow = {
  browser_hash: string;
  verifier: string;
  nonce: string;
  return_to: string;
  config_version: string;
};
async function start(request: Request, env: RuntimeEnv) {
  assertSameOrigin(request, {
    owner: false,
    trustedIdentity: null,
    scopes: [],
  });
  configured(env);
  checkOrigin(request, env);
  await rateLimit(env, "google-login", 20, 300);
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new AppError(415, "FORM_REQUIRED", "Use a login form.");
  const form = new URLSearchParams(
    new TextDecoder().decode(await boundedBody(request, 4096)),
  );
  if (
    [...form.keys()].some((k) => k !== "returnTo") ||
    form.getAll("returnTo").length > 1
  )
    throw new AppError(400, "INVALID_FORM", "Invalid login form.");
  const input = googleStartRequestSchema.parse({
    returnTo: form.get("returnTo") ?? undefined,
  });
  const state = randomToken(),
    browser = randomToken(),
    verifier = randomToken(),
    nonce = randomToken();
  const now = Date.now();
  const previous = readCookie(request, FLOW_COOKIE);
  const statements = [
    env
      .DB!.prepare("DELETE FROM google_auth_flows WHERE expires_at<=?")
      .bind(now),
  ];
  if (previous)
    statements.push(
      env
        .DB!.prepare("DELETE FROM google_auth_flows WHERE browser_hash=?")
        .bind(await sha256(previous)),
    );
  statements.push(
    env
      .DB!.prepare(
        "INSERT INTO google_auth_flows (state_hash,browser_hash,verifier,nonce,return_to,config_version,expires_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        await sha256(state),
        await sha256(browser),
        verifier,
        nonce,
        input.returnTo,
        await version(env),
        now + FLOW_SECONDS * 1000,
      ),
  );
  await env.DB!.batch(statements);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const target = new URL(AUTHORIZATION);
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: env.APP_ORIGIN! + CALLBACK,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return redirect(target.toString(), [
    cookie(FLOW_COOKIE, browser, FLOW_SECONDS),
  ]);
}
async function callback(request: Request, env: RuntimeEnv) {
  configured(env);
  checkOrigin(request, env);
  let denied = false;
  // 失败时只记录固定阶段标签，不记录 code、token、邮箱、state 或提供方错误内容。
  let stage:
    | "flow"
    | "provider_error"
    | "code"
    | "token"
    | "jwks"
    | "verify"
    | "claims"
    | "binding"
    | "owner"
    | "session" = "flow";
  try {
    const params = new URL(request.url).searchParams;
    const state = params.get("state"),
      browser = readCookie(request, FLOW_COOKIE);
    if (
      !state ||
      !opaque.test(state) ||
      !browser ||
      params.getAll("state").length !== 1
    )
      throw new Error("invalid flow");
    // 单条 DELETE RETURNING 原子消费，平行回调也最多成功一次；浏览器绑定失败不会消费他人的流程。
    const flow = await env
      .DB!.prepare(
        "DELETE FROM google_auth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING browser_hash,verifier,nonce,return_to,config_version",
      )
      .bind(await sha256(state), await sha256(browser), Date.now())
      .first<Flow>();
    if (!flow || !constantTimeEqual(flow.config_version, await version(env)))
      throw new Error("invalid flow");
    if (params.has("error")) {
      stage = "provider_error";
      denied = true;
      throw new Error("denied");
    }
    stage = "code";
    const code = params.get("code");
    if (!code || code.length > 4096 || params.getAll("code").length !== 1)
      throw new Error("invalid code");
    stage = "token";
    const token = z.object({ id_token: z.string().min(1).max(16384) }).parse(
      await providerJSON(TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: env.APP_ORIGIN! + CALLBACK,
          code_verifier: flow.verifier,
        }),
      }),
    );
    stage = "jwks";
    const keys = z
      .object({
        keys: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
      })
      .parse(await providerJSON(JWKS));
    stage = "verify";
    const { payload, protectedHeader } = await jwtVerify(
      token.id_token,
      createLocalJWKSet(keys as JSONWebKeySet),
      {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: env.GOOGLE_CLIENT_ID!,
        requiredClaims: [
          "sub",
          "email",
          "email_verified",
          "nonce",
          "iat",
          "exp",
        ],
        maxTokenAge: 600,
        clockTolerance: 5,
      },
    );
    if (protectedHeader.jku || protectedHeader.jwk || protectedHeader.x5u)
      throw new Error("unexpected key reference");
    stage = "claims";
    const identity = googleIdentityClaimsSchema.parse(payload);
    stage = "binding";
    if (
      !constantTimeEqual(identity.nonce, flow.nonce) ||
      (identity.azp !== undefined && identity.azp !== env.GOOGLE_CLIENT_ID) ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        identity.azp !== env.GOOGLE_CLIENT_ID)
    )
      throw new Error("invalid binding");
    stage = "owner";
    if (
      identity.email.trim().toLowerCase() !==
        env.OWNER_EMAIL!.trim().toLowerCase() ||
      (env.OWNER_GOOGLE_SUB && identity.sub !== env.OWNER_GOOGLE_SUB)
    ) {
      denied = true;
      throw new Error("not author");
    }
    stage = "session";
    const session = randomToken(),
      now = Date.now(),
      old = readCookie(request, SESSION_COOKIE);
    const statements = [
      env
        .DB!.prepare(
          "DELETE FROM google_author_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL",
        )
        .bind(now),
    ];
    if (old)
      statements.push(
        env
          .DB!.prepare(
            "UPDATE google_author_sessions SET revoked_at=? WHERE token_hash=?",
          )
          .bind(now, await sha256(old)),
      );
    statements.push(
      env
        .DB!.prepare(
          "INSERT INTO google_author_sessions (token_hash,config_version,created_at,expires_at) VALUES (?,?,?,?)",
        )
        .bind(
          await sha256(session),
          await version(env),
          now,
          now + SESSION_SECONDS * 1000,
        ),
    );
    await env.DB!.batch(statements);
    return redirect(flow.return_to, [
      cookie(FLOW_COOKIE, "", 0),
      cookie(SESSION_COOKIE, session, SESSION_SECONDS),
    ]);
  } catch (error) {
    // 固定错误码，不将提供方描述、邮箱、code 或 token 回传浏览器或日志；
    // 日志仅含阶段标签、结果与异常类型/固定错误码，不含异常消息。
    const e = error as { name?: unknown; code?: unknown };
    // 用户在 Google 取消 → info；伪造/过期流程、无效参数、非作者账号 → warn；
    // 提供方、验签、会话写入等失败 → error（需要排查）。
    logger[
      stage === "provider_error"
        ? "info"
        : stage === "flow" || stage === "code" || stage === "owner"
          ? "warn"
          : "error"
    ]("auth.google.callback_failed", {
      ...requestLogContext(request),
      stage,
      outcome: denied ? "google_denied" : "google_failed",
      errorName: typeof e?.name === "string" ? e.name : typeof error,
      ...(typeof e?.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(e.code)
        ? { errorCode: e.code }
        : {}),
    });
    return redirect(
      `/login?error=${denied ? "google_denied" : "google_failed"}`,
      [cookie(FLOW_COOKIE, "", 0)],
    );
  }
}
export async function googleSessionOwner(
  request: Request,
  env: RuntimeEnv,
): Promise<boolean> {
  if (
    !googleAuthConfigured(env) ||
    new URL(request.url).origin !== env.APP_ORIGIN
  )
    return false;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const row = await env
    .DB!.prepare(
      "SELECT config_version,expires_at FROM google_author_sessions WHERE token_hash=? AND revoked_at IS NULL",
    )
    .bind(await sha256(token))
    .first<{ config_version: string; expires_at: number }>();
  return (
    !!row &&
    row.expires_at > Date.now() &&
    constantTimeEqual(row.config_version, await version(env))
  );
}
export async function handleGoogleLogout(request: Request, env: RuntimeEnv) {
  configured(env);
  checkOrigin(request, env);
  const token = readCookie(request, SESSION_COOKIE);
  if (token)
    await env
      .DB!.prepare(
        "UPDATE google_author_sessions SET revoked_at=? WHERE token_hash=?",
      )
      .bind(Date.now(), await sha256(token))
      .run();
  return json({ ok: true }, 200, {
    "Set-Cookie": cookie(SESSION_COOKIE, "", 0),
  });
}
export async function handleGoogleAuth(
  request: Request,
  env: RuntimeEnv,
  action: string,
) {
  if (action === "start" && request.method === "POST")
    return start(request, env);
  if (action === "callback" && request.method === "GET")
    return callback(request, env);
  throw new AppError(404, "NOT_FOUND", "Not found.");
}
