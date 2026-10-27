import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { handleAPI } from "../../src/server/api";
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
    expect(init?.redirect).toBe("error");
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
    expect(await session.json()).toMatchObject({
      mode: "google",
      authenticated: false,
      configured: true,
    });
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
  it("PKCE和nonce、state由服务器生成，不接受开放跳转", async () => {
    const flow = await start("//attacker.test");
    expect(flow.target.origin).toBe("https://accounts.google.com");
    expect(flow.target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(flow.target.searchParams.get("redirect_uri")).toBe(
      "https://site.test/api/auth/google/callback",
    );
    expect(flow.target.searchParams.get("scope")).toBe("openid email");
    expect(flow.response.headers.get("set-cookie")).toContain("SameSite=Lax");
    const done = await finish(flow);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/studio");
  });
  it("真实签名成功后仅保存应用token摘要，退出撤销，配置轮换失效", async () => {
    const flow = await start();
    const done = await finish(flow);
    expect(done.headers.get("location")).toBe("/studio/settings");
    const cookie = done.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-mm_google_author="))!
      .split(";")[0];
    expect(
      await (await call("session", { headers: { cookie } })).json(),
    ).toMatchObject({ authenticated: true });
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
    expect(
      await (await call("session", { headers: { cookie } })).json(),
    ).toMatchObject({ authenticated: false });
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
  });
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
