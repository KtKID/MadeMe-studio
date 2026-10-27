import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { handleAPI } from "../../src/server/api";
import { captureLogs } from "./log-capture";
import { fixtureEnv } from "./support";
let env: ReturnType<typeof fixtureEnv>;
let signing: Awaited<ReturnType<typeof generateKeyPair>>;
let claims: Record<string, unknown>;
let nonce: string;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  env = fixtureEnv();
  Object.assign(env, {
    AUTH_MODE: "google",
    APP_ORIGIN: "https://site.test",
    OWNER_EMAIL: "owner@gmail.com",
    GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "fixture-only-secret",
  });
  signing = await generateKeyPair("RS256");
  claims = { email: "owner@gmail.com", email_verified: true };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    // Workers 仅支持 follow/manual；"error" 在真实 workerd 中会抛 TypeError。
    expect(init?.redirect).toBe("manual");
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({
        keys: [
          {
            ...(await exportJWK(signing.publicKey)),
            kid: "fixture",
            alg: "RS256",
            use: "sig",
          },
        ],
      });
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const payload = { nonce, ...claims };
    const id = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer("https://accounts.google.com")
      .setAudience(env.GOOGLE_CLIENT_ID!)
      .setSubject("fixture-owner-sub")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(signing.privateKey);
    return Response.json({
      id_token: id,
      access_token: "never-persist-this",
      token_type: "Bearer",
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.DB.close();
});
function call(path: string, init: RequestInit = {}) {
  return handleAPI({
    request: new Request(`https://site.test/api/auth/${path}`, init),
    locals: { env },
  });
}
async function start(returnTo = "/studio/settings") {
  const response = await call("google/start", {
    method: "POST",
    headers: {
      origin: env.APP_ORIGIN!,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ returnTo }),
  });
  expect(response.status).toBe(303);
  const target = new URL(response.headers.get("location")!);
  nonce = target.searchParams.get("nonce")!;
  return {
    response,
    target,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    state: target.searchParams.get("state")!,
  };
}
async function finish(
  flow: Awaited<ReturnType<typeof start>>,
  cookie = flow.cookie,
) {
  return call(`google/callback?state=${flow.state}&code=fixture-code`, {
    headers: { cookie },
  });
}
describe("Google 单作者 OAuth 安全边界", () => {
  it("先验证同源HTTPS和配置，拒绝身份头旁路", async () => {
    expect((await call("google/start", { method: "POST" })).status).toBe(403);
    const session = await call("session", {
      headers: {
        "oai-authenticated-user-id": "owner",
        "oai-authenticated-user-email": env.OWNER_EMAIL!,
      },
    });
    const unauthenticated = await session.json();
    expect(unauthenticated).toEqual({
      mode: "google",
      authenticated: false,
      configured: true,
    });
    // 伪造身份头不能换来账号名。
    expect(unauthenticated).not.toHaveProperty("account");
    env.GOOGLE_CLIENT_SECRET = undefined;
    expect(
      (
        await call("google/start", {
          method: "POST",
          headers: { origin: env.APP_ORIGIN! },
        })
      ).status,
    ).toBe(503);
  });
  it("Origin: null 的表单 POST 仍被拒绝（/login 不能使用 no-referrer 的原因）", async () => {
    const response = await call("google/start", {
      method: "POST",
      headers: {
        origin: "null",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ returnTo: "/studio" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "CSRF_REJECTED" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("PKCE和nonce、state由服务器生成，不接受开放跳转", async () => {
    const flow = await start("//attacker.test");
    expect(flow.target.origin).toBe("https://accounts.google.com");
    expect(flow.target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(flow.target.searchParams.get("redirect_uri")).toBe(
      "https://site.test/api/auth/google/callback",
    );
    expect(flow.target.searchParams.get("scope")).toBe("openid email profile");
    expect(flow.response.headers.get("set-cookie")).toContain("SameSite=Lax");
    const done = await finish(flow);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/studio");
  });
  it("真实签名成功后仅保存应用token摘要，退出撤销，配置轮换失效", async () => {
    const logs = captureLogs();
    const flow = await start();
    const done = await finish(flow);
    expect(done.headers.get("location")).toBe("/studio/settings");
    const cookie = done.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-mm_google_author="))!
      .split(";")[0];
    expect(
      await (await call("session", { headers: { cookie } })).json(),
    ).toEqual({
      mode: "google",
      configured: true,
      authenticated: true,
      account: "owner@gmail.com",
    });
    const rows = env.DB.sqlite
      .prepare("SELECT * FROM google_author_sessions")
      .all();
    expect(JSON.stringify(rows)).not.toContain("never-persist-this");
    expect(JSON.stringify(rows)).not.toContain(cookie.split("=")[1]);
    env.GOOGLE_CLIENT_SECRET = "rotated-fixture";
    expect(
      await (await call("session", { headers: { cookie } })).json(),
    ).toMatchObject({ authenticated: false });
    env.GOOGLE_CLIENT_SECRET = "fixture-only-secret";
    expect(
      (
        await call("logout", {
          method: "POST",
          headers: { origin: env.APP_ORIGIN!, cookie },
        })
      ).status,
    ).toBe(200);
    const afterLogout = await (
      await call("session", { headers: { cookie } })
    ).json();
    expect(afterLogout).toMatchObject({ authenticated: false });
    expect(afterLogout).not.toHaveProperty("account");
    // 账号名只返回给作者本人，绝不进入日志。
    expect(logs.raw()).not.toContain("owner@gmail.com");
  });
  it("Google 昵称经清洗存入会话并只返回给作者本人；无昵称/旧会话回退邮箱", async () => {
    const logs = captureLogs();
    claims = {
      ...claims,
      name: "  小\u202e明\u0000  Ｍing\n" + "长".repeat(100),
    };
    const done = await finish(await start());
    const cookie = done.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-mm_google_author="))!
      .split(";")[0];
    const session = (await (
      await call("session", { headers: { cookie } })
    ).json()) as { account?: string; accountName?: string };
    expect(session.account).toBe("owner@gmail.com");
    expect(session.accountName).toBe("小明 Ｍing " + "长".repeat(64 - 8));
    expect(Array.from(session.accountName as string)).toHaveLength(64);
    const row = env.DB.sqlite
      .prepare("SELECT display_name FROM google_author_sessions")
      .get() as { display_name: string };
    expect(row.display_name).toBe(session.accountName);
    expect(logs.raw()).not.toContain("小明");
    expect(logs.raw()).not.toContain("owner@gmail.com");
    // 迁移前的旧会话没有昵称：仅返回邮箱。
    env.DB.sqlite.exec("UPDATE google_author_sessions SET display_name=NULL");
    const legacy = await (
      await call("session", { headers: { cookie } })
    ).json();
    expect(legacy).toEqual({
      mode: "google",
      configured: true,
      authenticated: true,
      account: "owner@gmail.com",
    });
    // 未登录不返回昵称。
    expect(await (await call("session")).json()).not.toHaveProperty(
      "accountName",
    );
  });
  it("昵称缺失或类型异常不阻止登录", async () => {
    claims = { ...claims, name: { evil: true } };
    const done = await finish(await start());
    expect(done.headers.get("location")).toBe("/studio/settings");
    const cookie = done.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-mm_google_author="))!
      .split(";")[0];
    expect(
      await (await call("session", { headers: { cookie } })).json(),
    ).not.toHaveProperty("accountName");
  });
  it("浏览器绑定不匹配和重放不能签发会话", async () => {
    const flow = await start();
    expect(
      (await finish(flow, "__Host-mm_google_oauth=invalid")).headers.get(
        "location",
      ),
    ).toBe("/login?error=google_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    await finish(flow);
    const count = fetchMock.mock.calls.length;
    expect((await finish(flow)).headers.get("location")).toBe(
      "/login?error=google_failed",
    );
    expect(fetchMock.mock.calls.length).toBe(count);
  });
  it.each([
    { email: "other@example.test" },
    { email_verified: false },
    { nonce: "wrong" },
    { azp: "other-client" },
  ])("拒绝错误声明 %j", async (extra) => {
    claims = { ...claims, ...extra };
    const flow = await start();
    const done = await finish(flow);
    expect(done.headers.get("location")).toMatch(
      /^\/login\?error=google_(failed|denied)$/,
    );
    expect(
      env.DB.sqlite
        .prepare("SELECT COUNT(*) AS n FROM google_author_sessions")
        .get()?.n,
    ).toBe(0);
  });
  it("篡改签名拒绝且不泄露provider响应", async () => {
    const logs = captureLogs();
    const flow = await start();
    fetchMock.mockImplementation(async () =>
      Response.json({
        id_token: "secret-invalid-token",
        error_description: "secret-email@example.test",
      }),
    );
    const done = await finish(flow);
    expect(done.headers.get("location")).toBe("/login?error=google_failed");
    expect(await done.text()).not.toContain("secret");
    expect(logs.find("auth.google.callback_failed")).toHaveLength(1);
    expect(logs.raw()).not.toContain("secret-invalid-token");
    expect(logs.raw()).not.toContain("secret-email");
  });
  it("provider fetch 使用 Workers 支持的 redirect 模式，3xx 视为失败且日志只含阶段", async () => {
    const logs = captureLogs();
    const ok = await finish(await start());
    expect(ok.headers.get("location")).toBe("/studio/settings");
    for (const [, init] of fetchMock.mock.calls)
      expect(["follow", "manual"]).toContain(init?.redirect);
    const flow = await start();
    fetchMock.mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.test/token" },
        }),
    );
    const done = await finish(flow);
    expect(done.headers.get("location")).toBe("/login?error=google_failed");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(logs.find("auth.google.callback_failed").at(-1)).toMatchObject({
      level: "error",
      stage: "token",
      outcome: "google_failed",
      path: "/api/auth/google/callback",
    });
    expect(logs.find("auth.google.provider_failed").at(-1)).toMatchObject({
      level: "warn",
      endpoint: "token",
      httpStatus: 302,
    });
    const logged = logs.raw();
    for (const leak of [
      flow.state,
      "fixture-code",
      env.OWNER_EMAIL!,
      env.GOOGLE_CLIENT_SECRET!,
      "attacker.test",
    ])
      expect(logged).not.toContain(leak);
  });
  it.each(["jwks", "verify"] as const)(
    "失败阶段 %s 被准确记录",
    async (stage) => {
      const logs = captureLogs();
      const flow = await start();
      const real = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "https://www.googleapis.com/oauth2/v3/certs") {
          if (stage === "jwks") return new Response("no", { status: 500 });
          const other = await generateKeyPair("RS256");
          return Response.json({
            keys: [{ ...(await exportJWK(other.publicKey)), kid: "fixture" }],
          });
        }
        return real(url, init);
      });
      const done = await finish(flow);
      expect(done.headers.get("location")).toBe("/login?error=google_failed");
      expect(logs.find("auth.google.callback_failed").at(-1)).toMatchObject({
        level: "error",
        stage,
      });
      expect(logs.raw()).not.toContain(flow.state);
    },
  );
});

describe("Google 会话生命周期与写入保护", () => {
  it("流程过期/配置改变在网络调用前失败", async () => {
    const expired = await start();
    env.DB.sqlite.exec("UPDATE google_auth_flows SET expires_at=0");
    expect((await finish(expired)).headers.get("location")).toBe(
      "/login?error=google_failed",
    );
    const changed = await start();
    env.SESSION_SECRET += "rotation";
    expect((await finish(changed)).headers.get("location")).toBe(
      "/login?error=google_failed",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("退出和正常写API不能被跨站Origin或Bearer豁免", async () => {
    const done = await finish(await start());
    const cookie = done.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-mm_google_author="))!
      .split(";")[0];
    expect(
      (
        await call("logout", {
          method: "POST",
          headers: {
            cookie,
            origin: "https://evil.test",
            authorization: "Bearer fake",
          },
        })
      ).status,
    ).toBe(403);
    const response = await handleAPI({
      request: new Request("https://site.test/api/settings", {
        method: "PATCH",
        headers: {
          cookie,
          origin: "https://evil.test",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      locals: { env },
    });
    expect(response.status).toBe(403);
    env.DB.sqlite.exec("UPDATE google_author_sessions SET expires_at=0");
    expect(
      await (await call("session", { headers: { cookie } })).json(),
    ).toMatchObject({ authenticated: false });
  });
  it("非Gmail配置必须钉住subject，错误模式不能开始Google流程", async () => {
    env.OWNER_EMAIL = "owner@example.test";
    expect(await (await call("session")).json()).toMatchObject({
      configured: false,
    });
    env.OWNER_GOOGLE_SUB = "fixture-owner-sub";
    expect(await (await call("session")).json()).toMatchObject({
      configured: true,
    });
    env.AUTH_MODE = "sites";
    expect(
      (
        await call("google/start", {
          method: "POST",
          headers: { origin: env.APP_ORIGIN! },
        })
      ).status,
    ).toBe(503);
  });
});
