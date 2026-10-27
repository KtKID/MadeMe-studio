import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { handleAPI } from "../../src/server/api";
import { fixtureEnv } from "./support";

// 独立协议安全回归：真实 RSA 签名及 SQLite；不连接 Google、不代表真实提供方验收。
let env: ReturnType<typeof fixtureEnv>;
let key: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKey: Awaited<ReturnType<typeof generateKeyPair>>;
let payload: JWTPayload;
let header: Record<string, unknown>;
let wrongKey: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  key = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
});
beforeEach(() => {
  env = fixtureEnv();
  Object.assign(env, {
    AUTH_MODE: "google",
    APP_ORIGIN: "https://site.test",
    OWNER_EMAIL: "owner@gmail.com",
    GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "fixture-secret",
  });
  const now = Math.floor(Date.now() / 1000);
  payload = {
    iss: "https://accounts.google.com",
    aud: env.GOOGLE_CLIENT_ID,
    sub: "fixture-sub",
    iat: now,
    exp: now + 300,
    email: "owner@gmail.com",
    email_verified: true,
  };
  header = { alg: "RS256", kid: "security-fixture" };
  wrongKey = false;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    // Workers 仅支持 follow/manual；"error" 在真实 workerd 中会抛 TypeError。
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({
        keys: [
          {
            ...(await exportJWK(key.publicKey)),
            kid: "security-fixture",
            alg: "RS256",
            use: "sig",
          },
        ],
      });
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const signed = await new SignJWT(payload)
      .setProtectedHeader(header as { alg: string })
      .sign(wrongKey ? otherKey.privateKey : key.privateKey);
    return Response.json({
      id_token: signed,
      access_token: "fixture-access-secret",
      refresh_token: "fixture-refresh-secret",
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.DB.close();
});
function call(
  path: string,
  init: RequestInit = {},
  origin = "https://site.test",
) {
  return handleAPI({
    request: new Request(`${origin}/api/auth/${path}`, init),
    locals: { env },
  });
}
async function start() {
  const response = await call("google/start", {
    method: "POST",
    headers: {
      origin: env.APP_ORIGIN!,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "returnTo=%2Fstudio",
  });
  expect(response.status).toBe(303);
  const url = new URL(response.headers.get("location")!);
  payload.nonce = url.searchParams.get("nonce");
  return {
    state: url.searchParams.get("state")!,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    url,
  };
}
function finish(flow: Awaited<ReturnType<typeof start>>, query = "") {
  return call(`google/callback?state=${flow.state}&code=fixture-code${query}`, {
    headers: { cookie: flow.cookie },
  });
}
function sessions() {
  return env.DB.sqlite.prepare("SELECT * FROM google_author_sessions").all();
}
async function rejected(flow: Awaited<ReturnType<typeof start>>) {
  const response = await finish(flow);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toMatch(
    /^\/login\?error=google_(failed|denied)$/,
  );
  expect(sessions()).toHaveLength(0);
}

describe("独立 Google JWT 真实签名边界", () => {
  it("接受正确签名，PKCE challenge 与提交 verifier 对应且未请求离线权限", async () => {
    const flow = await start();
    const response = await finish(flow);
    expect(response.headers.get("location")).toBe("/studio");
    const body = new URLSearchParams(
      fetchMock.mock.calls.find(
        ([url]) => url === "https://oauth2.googleapis.com/token",
      )![1]!.body as URLSearchParams,
    );
    const challenge = Buffer.from(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body.get("code_verifier")!),
      ),
    ).toString("base64url");
    expect(challenge).toBe(flow.url.searchParams.get("code_challenge"));
    expect(flow.url.searchParams.has("access_type")).toBe(false);
    expect(flow.url.searchParams.get("scope")).toBe("openid email");
    expect(JSON.stringify(sessions())).not.toMatch(
      /fixture-(access|refresh)-secret/,
    );
  });
  it.each([
    "iss",
    "aud",
    "sub",
    "iat",
    "exp",
    "email",
    "email_verified",
    "nonce",
  ])("拒绝缺失 %s", async (claim) => {
    const flow = await start();
    delete payload[claim];
    await rejected(flow);
  });
  it.each([
    ["issuer", { iss: "https://attacker.test" }],
    ["audience", { aud: "other-client" }],
    ["future iat", { iat: Math.floor(Date.now() / 1000) + 60 }],
    ["stale iat", { iat: Math.floor(Date.now() / 1000) - 700 }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["string email_verified", { email_verified: "true" }],
    ["wrong nonce", { nonce: "unbound" }],
    [
      "multiple audience without azp",
      { aud: ["fixture.apps.googleusercontent.com", "other-client"] },
    ],
    ["wrong azp", { azp: "other-client" }],
  ] as const)("拒绝 %s", async (_name, claims) => {
    const flow = await start();
    Object.assign(payload, claims);
    await rejected(flow);
  });
  it("同 kid 但不同私钥签名不能通过", async () => {
    const flow = await start();
    wrongKey = true;
    await rejected(flow);
  });
  it.each(["jku", "x5u", "jwk"])(
    "不接受 JWT 自带 %s 密钥引用",
    async (name) => {
      const flow = await start();
      header[name] =
        name === "jwk"
          ? await exportJWK(key.publicKey)
          : "https://attacker.test/key";
      await rejected(flow);
      expect(
        fetchMock.mock.calls.every(
          ([url]) => !String(url).includes("attacker"),
        ),
      ).toBe(true);
    },
  );
  it("配置 Google subject 后拒绝不同 subject", async () => {
    env.OWNER_GOOGLE_SUB = "pinned-sub";
    const flow = await start();
    await rejected(flow);
  });
  it("多 audience 仅在正确 azp 时可通过", async () => {
    const flow = await start();
    payload.aud = [env.GOOGLE_CLIENT_ID!, "other-client"];
    payload.azp = env.GOOGLE_CLIENT_ID;
    expect((await finish(flow)).headers.get("location")).toBe("/studio");
  });
  it("超过有界响应上限不签发 session", async () => {
    const flow = await start();
    fetchMock.mockResolvedValue(new Response("x".repeat(65537)));
    await rejected(flow);
  });
});

describe("独立流程并发与部署边界", () => {
  it("并发回调只允许一次 code 兑换和 session 写入", async () => {
    const flow = await start();
    const responses = await Promise.all([finish(flow), finish(flow)]);
    expect(
      responses.filter((r) => r.headers.get("location") === "/studio"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "https://oauth2.googleapis.com/token",
      ),
    ).toHaveLength(1);
    expect(sessions()).toHaveLength(1);
  });
  it("重复 query 参数在 token 兑换前拒绝", async () => {
    const flow = await start();
    const response = await finish(flow, "&code=second-secret");
    expect(response.headers.get("location")).toBe("/login?error=google_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Google 模式拒绝 localhost dev identity 以及 Sites identity 头", async () => {
    Object.assign(env, {
      ENVIRONMENT: "development",
      ALLOW_LOCAL_DEV_IDENTITY: "true",
      DEV_OWNER_ID: env.OWNER_ID,
    });
    for (const origin of ["https://localhost", "https://site.test"]) {
      const response = await call(
        "session",
        {
          headers: {
            "oai-authenticated-user-id": env.OWNER_ID!,
            "oai-authenticated-user-email": env.OWNER_EMAIL!,
          },
        },
        origin,
      );
      expect(await response.json()).toMatchObject({ authenticated: false });
    }
  });
  it("固定 APP_ORIGIN 以外的 HTTPS 主机不能开始或完成登录", async () => {
    const response = await call(
      "google/start",
      {
        method: "POST",
        headers: {
          origin: "https://other.test",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "",
      },
      "https://other.test",
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
