import { describe, it, expect } from "vitest";
import {
  authenticate,
  assertSameOrigin,
  requireScope,
  requireOwner,
} from "../../src/server/auth/identity";
import { hashPassword, verifyPassword } from "../../src/server/auth/crypto";
import { defaultSettings } from "../../src/shared/contracts";
import { redactSettings } from "../../src/server/settings";
const request = (headers: HeadersInit = {}, host = "https://site.test") =>
  new Request(host, { headers });
describe("身份与 CSRF 单元测试", () => {
  it("默认拒绝自报 Sites 身份和缺失身份", async () => {
    expect(
      (
        await authenticate(request({ "oai-authenticated-user-id": "owner" }), {
          OWNER_ID: "owner",
        })
      ).owner,
    ).toBe(false);
    expect(
      (await authenticate(request(), { AUTH_MODE: "sites", OWNER_ID: "owner" }))
        .owner,
    ).toBe(false);
  });
  it("只接受明确绑定的拥有者，不接受首个访问者", async () => {
    const env = { AUTH_MODE: "sites", OWNER_ID: "owner" };
    expect(
      (
        await authenticate(
          request({ "oai-authenticated-user-id": "owner" }),
          env,
        )
      ).owner,
    ).toBe(true);
    expect(
      (
        await authenticate(
          request({ "oai-authenticated-user-id": "stranger" }),
          env,
        )
      ).owner,
    ).toBe(false);
    expect(
      (
        await authenticate(request({ "oai-authenticated-user-id": "owner" }), {
          AUTH_MODE: "sites",
        })
      ).owner,
    ).toBe(false);
  });
  it("明确邮箱绑定仍需要可信 id，OWNER_ID 优先且禁止回退", async () => {
    const headers = {
      "oai-authenticated-user-id": "pairwise",
      "oai-authenticated-user-email": "owner@example.test",
    };
    expect(
      (
        await authenticate(request(headers), {
          AUTH_MODE: "sites",
          OWNER_EMAIL: "OWNER@example.test",
        })
      ).owner,
    ).toBe(true);
    expect(
      (
        await authenticate(
          request({ "oai-authenticated-user-email": "owner@example.test" }),
          { AUTH_MODE: "sites", OWNER_EMAIL: "owner@example.test" },
        )
      ).owner,
    ).toBe(false);
    expect(
      (
        await authenticate(request(headers), {
          AUTH_MODE: "sites",
          OWNER_ID: "different",
          OWNER_EMAIL: "owner@example.test",
        })
      ).owner,
    ).toBe(false);
    expect(
      (
        await authenticate(request(headers), {
          OWNER_EMAIL: "owner@example.test",
        })
      ).owner,
    ).toBe(false);
  });
  it("开发身份必须同时满足开发模式、显式开关、本地地址、明确绑定", async () => {
    const env = {
      ENVIRONMENT: "development",
      ALLOW_LOCAL_DEV_IDENTITY: "true",
      DEV_OWNER_ID: "dev",
      OWNER_ID: "dev",
    };
    expect(
      (await authenticate(request({}, "http://localhost:4321"), env)).owner,
    ).toBe(true);
    expect(
      (await authenticate(request({}, "https://site.test"), env)).owner,
    ).toBe(false);
    expect(
      (
        await authenticate(request({}, "http://localhost:4321"), {
          ...env,
          ENVIRONMENT: "production",
        })
      ).owner,
    ).toBe(false);
  });
  it("拒绝跨站、空 Origin，并严格检查 token scope", () => {
    const identity = { owner: true, trustedIdentity: "owner", scopes: [] };
    expect(() =>
      assertSameOrigin(request({ origin: "https://evil.test" }), identity),
    ).toThrow();
    expect(() => assertSameOrigin(request(), identity)).toThrow();
    expect(() =>
      assertSameOrigin(request({ origin: "https://site.test" }), identity),
    ).not.toThrow();
    expect(() =>
      requireScope(
        {
          owner: false,
          trustedIdentity: null,
          tokenId: "x",
          scopes: ["posts:write"],
        },
        { OWNER_ID: "owner" },
        "posts:publish",
      ),
    ).toThrow();
    expect(() => requireOwner(identity, {})).toThrow(/configured/);
  });
});
describe("敏感数据单元测试", () => {
  it("密码使用带随机盐的 PBKDF2，不保存原文", async () => {
    const hash = await hashPassword("correct-password");
    expect(hash).not.toContain("correct-password");
    expect(await verifyPassword("correct-password", hash)).toBe(true);
    expect(await verifyPassword("incorrect", hash)).toBe(false);
    expect(await hashPassword("correct-password")).not.toBe(hash);
  });
  it("访客设置清除模型、prompt 和自定义代码，返回值不含运行时密钥", () => {
    const settings = {
      ...defaultSettings,
      customCode: "private-code",
      prompts: [
        {
          id: "p",
          name: "Private",
          action: "polish" as const,
          template: "private-prompt",
        },
      ],
      providers: [
        {
          id: "x",
          name: "API",
          kind: "openai" as const,
          model: "model",
          temperature: 0.7,
          maxTokens: 100,
          configured: false,
        },
      ],
    };
    const env = { OPENAI_API_KEY: "secret-test-value" };
    const publicValue = redactSettings(settings, false, env);
    expect(publicValue.providers).toEqual([]);
    expect(publicValue.prompts).toEqual([]);
    expect(publicValue.customCode).toBe("");
    const ownerValue = redactSettings(settings, true, env);
    expect(ownerValue.providers[0].configured).toBe(true);
    expect(JSON.stringify(ownerValue)).not.toContain(env.OPENAI_API_KEY);
  });
});
