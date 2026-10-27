import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAPI } from "../../src/server/api";
import { hashAuthorPassword } from "../../src/server/auth/password";
import { safeReturnTo } from "../../src/shared/auth";
import { authenticate } from "../../src/server/auth/identity";
import { createToken } from "../../src/server/tokens";
import { fixtureEnv } from "./support";
let env: ReturnType<typeof fixtureEnv>;
const password = "temporary-test-only-password";
let hash: string;
beforeEach(async () => {
  env = fixtureEnv();
  env.AUTH_MODE = "password";
  env.OWNER_EMAIL = "author@example.test";
  hash ??= await hashAuthorPassword(password);
  env.AUTH_PASSWORD_HASH = hash;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.DB.close();
});
function call(
  path: string,
  body?: unknown,
  cookie?: string,
  extra: Record<string, string> = {},
) {
  return handleAPI({
    request: new Request(`https://site.test/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "https://site.test",
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    locals: { env },
  });
}
const credentials = {
  email: "author@example.test",
  password,
  returnTo: "/studio/settings",
};
describe("独立单作者登录", () => {
  it("登录设置安全Cookie，轮换旧session，退出后服务器撤销", async () => {
    const login = await call("login", credentials);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({
      ok: true,
      returnTo: "/studio/settings",
    });
    const cookie = login.headers.get("set-cookie")!;
    for (const flag of [
      "__Host-mm_author=",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Path=/",
    ])
      expect(cookie).toContain(flag);
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({
      authenticated: true,
      mode: "password",
      configured: true,
    });
    const next = await call("login", credentials, cookie);
    const nextCookie = next.headers.get("set-cookie")!;
    expect(nextCookie).not.toBe(cookie);
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({ authenticated: false });
    expect((await call("logout", {}, nextCookie)).status).toBe(200);
    expect(
      await (await call("session", undefined, nextCookie)).json(),
    ).toMatchObject({ authenticated: false });
  });
  it("变更配置、过期和缺配置失败关闭", async () => {
    const cookie = (await call("login", credentials)).headers.get(
      "set-cookie",
    )!;
    env.OWNER_EMAIL = "changed@example.test";
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({ authenticated: false });
    env.OWNER_EMAIL = credentials.email;
    env.DB.sqlite.exec("UPDATE author_sessions SET expires_at=0");
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({ authenticated: false });
    env.AUTH_PASSWORD_HASH = undefined;
    expect((await call("login", credentials)).status).toBe(503);
  });
  it("不区分不存在邮箱与错误密码，并持久化限流", async () => {
    // 固定窗口内采样，避免真实时钟跨限流窗口使断言偶发失效。
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 27, 3, 0, 30));
    const a = await call("login", {
      ...credentials,
      email: "other@example.test",
    });
    const b = await call("login", { ...credentials, password: "wrong" });
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    for (let i = 0; i < 3; i++)
      await call("login", { ...credentials, password: "wrong" });
    expect((await call("login", credentials)).status).toBe(429);
  });
  it("登录退出不允许跨站或Bearer跳过CSRF，不读取Sites伪造头", async () => {
    expect(
      (
        await call("login", credentials, undefined, {
          Origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("logout", {}, undefined, {
          Origin: "https://evil.test",
          Authorization: "Bearer invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      await (
        await call("session", undefined, undefined, {
          "oai-authenticated-user-id": "test-owner",
        })
      ).json(),
    ).toMatchObject({ authenticated: false });
  });
  it("安全returnTo拒绝站外和编码混淆", () => {
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/%2f%2fevil.test",
      "/\n/evil.test",
    ])
      expect(safeReturnTo(path)).toBe("/studio");
    expect(safeReturnTo("/studio/posts?draft=1")).toBe("/studio/posts?draft=1");
  });
  it("密码和会话密钥轮换使旧会话失效；篡改和重复cookie也不授权", async () => {
    const cookie = (await call("login", credentials)).headers.get(
      "set-cookie",
    )!;
    const original = env.AUTH_PASSWORD_HASH!;
    const originalSecret = env.SESSION_SECRET!;
    env.AUTH_PASSWORD_HASH =
      original.slice(0, -1) + (original.endsWith("0") ? "1" : "0");
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({ authenticated: false });
    env.AUTH_PASSWORD_HASH = original;
    env.SESSION_SECRET = "another-test-only-secret-long-enough-0000";
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({ authenticated: false });
    env.SESSION_SECRET = originalSecret;
    expect(
      await (await call("session", undefined, cookie)).json(),
    ).toMatchObject({ authenticated: true });
    expect(
      await (
        await call("session", undefined, cookie.replace("mm_", "xx_"))
      ).json(),
    ).toMatchObject({ authenticated: false });
    expect(
      await (await call("session", undefined, cookie + "; " + cookie)).json(),
    ).toMatchObject({ authenticated: false });
  });
  it("独立模式不会接受本地开发身份；Bearer权限不能被cookie放大", async () => {
    const cookie = (await call("login", credentials)).headers.get(
      "set-cookie",
    )!;
    const token = await createToken(env, {
      name: "test",
      scopes: ["posts:read"],
      expiresInDays: 1,
    });
    const identity = await authenticate(
      new Request("https://site.test", {
        headers: { Cookie: cookie, Authorization: `Bearer ${token.token}` },
      }),
      env,
    );
    expect(identity).toMatchObject({
      owner: false,
      tokenId: token.id,
      scopes: ["posts:read"],
    });
    const denied = await handleAPI({
      request: new Request("https://site.test/api/settings", {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
      locals: { env },
    });
    expect(denied.status).toBe(403);
    env.ENVIRONMENT = "development";
    env.ALLOW_LOCAL_DEV_IDENTITY = "true";
    env.DEV_OWNER_ID = "test-owner";
    expect(
      await authenticate(
        new Request("http://localhost", {
          headers: { "oai-authenticated-user-id": "test-owner" },
        }),
        env,
      ),
    ).toMatchObject({ owner: false });
  });
  it("缺Origin、错误method和超长输入拒绝；不反射秘密", async () => {
    expect(
      (await call("login", credentials, undefined, { Origin: "" })).status,
    ).toBe(403);
    expect((await call("login")).status).toBe(404);
    expect(
      (await call("login", { ...credentials, password: "x".repeat(9000) }))
        .status,
    ).toBe(413);
    const response = await call("session");
    const text = await response.text();
    expect(text).not.toContain(env.AUTH_PASSWORD_HASH!);
    expect(text).not.toContain(env.SESSION_SECRET!);
  });
  it.each(["pbkdf2:100000:abc:def", "pbkdf2-sha256:1:abc:def", "malformed"])(
    "畸形或低强度hash失败关闭 %s",
    async (hash) => {
      env.AUTH_PASSWORD_HASH = hash;
      expect((await call("login", credentials)).status).toBe(503);
    },
  );
  it("生产平台KDF拒绝600k时明确503且不降级", async () => {
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockRejectedValueOnce(new Error("platform cap"));
    try {
      const response = await call("login", credentials);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTH_KDF_UNAVAILABLE" },
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(
        env.DB.sqlite.prepare("SELECT count(*) AS n FROM author_sessions").get()
          ?.n,
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it("新作者口令配置拒绝短密码，不影响登录通用错误", async () => {
    await expect(hashAuthorPassword("short")).rejects.toThrow();
  });
});
