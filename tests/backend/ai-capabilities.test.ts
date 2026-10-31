import { readFileSync } from "node:fs";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { providerSchema, defaultSettings } from "../../src/shared/contracts";
import {
  readSettings,
  redactSettings,
  writeSettings,
} from "../../src/server/settings";
import { runAI, generateImage } from "../../src/server/ai/service";
import { loadPageData } from "../../src/server/page-data";
import { fixtureEnv } from "./support";
const env = fixtureEnv();
afterAll(() => env.DB.close());
const provider = (id: string, kind = "openai") =>
  providerSchema.parse({ id, name: id, kind, model: "fixture-model" });
afterEach(() => {
  vi.unstubAllGlobals();
  delete env.OPENAI_API_KEY;
  delete env.IMAGE_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.CLOUDFLARE_AI_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
});
it("旧 provider 协议仍可解析；独立图片密钥只声明图片配置", () => {
  env.IMAGE_API_KEY = "fixture-only";
  const result = redactSettings(
    { ...defaultSettings, providers: [provider("first")] },
    true,
    env,
  );
  expect(result.providers[0]).toMatchObject({
    textConfigured: false,
    imageConfigured: true,
  });
  expect(JSON.stringify(result)).not.toContain("fixture-only");
});
it("Cloudflare 缺账户 ID 不声明文本或图片配置", () => {
  env.CLOUDFLARE_AI_TOKEN = "fixture-token";
  const settings = {
    ...defaultSettings,
    providers: [provider("cf", "cloudflare")],
  };
  expect(redactSettings(settings, true, env).providers[0]).toMatchObject({
    textConfigured: false,
    imageConfigured: false,
  });
  env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  expect(redactSettings(settings, true, env).providers[0]).toMatchObject({
    textConfigured: true,
    imageConfigured: true,
  });
  expect(redactSettings(settings, false, env).providers).toEqual([]);
});
it("默认文本跳过首个未配置提供商", async () => {
  env.GEMINI_API_KEY = "fixture-gemini";
  await writeSettings(env, {
    providers: [provider("first"), provider("second", "gemini")],
  });
  const mockedFetch = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      candidates: [{ content: { parts: [{ text: "fixture answer" }] } }],
    }),
  );
  vi.stubGlobal("fetch", mockedFetch);
  await expect(
    runAI(env, { action: "polish", selection: "fixture" }),
  ).resolves.toBeDefined();
  expect(String(mockedFetch.mock.calls[0][0])).toContain(
    "generativelanguage.googleapis.com",
  );
});
it("显式未配置提供商不可隐式切换或调用网络", async () => {
  env.GEMINI_API_KEY = "fixture-gemini";
  await writeSettings(env, {
    providers: [provider("first"), provider("second", "gemini")],
  });
  const mockedFetch = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mockedFetch);
  await expect(
    runAI(env, { action: "polish", selection: "fixture", providerId: "first" }),
  ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  await expect(
    generateImage(env, { prompt: "fixture", providerId: "first" }),
  ).rejects.toMatchObject({ code: "IMAGE_NOT_CONFIGURED" });
  expect(mockedFetch).not.toHaveBeenCalled();
});
it("默认生图跳过缺账户的 Cloudflare 并使用独立 OpenAI 图片密钥", async () => {
  env.CLOUDFLARE_AI_TOKEN = "fixture-cf";
  env.IMAGE_API_KEY = "fixture-image";
  await writeSettings(env, {
    providers: [provider("cf", "cloudflare"), provider("oa")],
  });
  const mockedFetch = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      data: [
        {
          b64_json: readFileSync("tests/fixtures/valid-image.png").toString(
            "base64",
          ),
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", mockedFetch);
  await expect(
    generateImage(env, { prompt: "fixture" }),
  ).resolves.toBeDefined();
  expect(String(mockedFetch.mock.calls[0][0])).toContain("api.openai.com");
});

it("客户端伪造能力不会持久化或绕过服务端", async () => {
  await writeSettings(env, {
    providers: [
      {
        ...provider("spoofed"),
        configured: true,
        textConfigured: true,
        imageConfigured: true,
      },
    ],
  });
  const settings = await readSettings(env);
  expect(settings.providers[0].textConfigured).toBeUndefined();
  expect(settings.providers[0].imageConfigured).toBeUndefined();
  expect(redactSettings(settings, true, env).providers[0]).toMatchObject({
    configured: false,
    textConfigured: false,
    imageConfigured: false,
  });
  const mockedFetch = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mockedFetch);
  await expect(
    runAI(env, { action: "polish", selection: "fixture" }),
  ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  expect(mockedFetch).not.toHaveBeenCalled();
});

it("页面整体能力与每个提供商配置态一致，缺 Cloudflare 账户时不可用", async () => {
  env.CLOUDFLARE_AI_TOKEN = "fixture-cf";
  await writeSettings(env, {
    providers: [provider("cf", "cloudflare"), provider("oa")],
  });
  const context = {
    request: new Request("https://site.test", {
      headers: { "oai-authenticated-user-id": "test-owner" },
    }),
    locals: { env },
  };
  const missing = await loadPageData(context);
  expect(missing.capabilities).toMatchObject({
    aiConfigured: false,
    imageConfigured: false,
  });
  env.IMAGE_API_KEY = "fixture-image";
  const imageOnly = await loadPageData(context);
  expect(imageOnly.capabilities).toMatchObject({
    aiConfigured: false,
    imageConfigured: true,
  });
  expect(imageOnly.settings.providers[1]).toMatchObject({
    textConfigured: false,
    imageConfigured: true,
  });
});
it("Prompt 绑定未配置提供商不会绕过显式选择校验", async () => {
  env.GEMINI_API_KEY = "fixture-gemini";
  await writeSettings(env, {
    providers: [provider("first"), provider("second", "gemini")],
    prompts: [
      {
        id: "p",
        name: "fixture",
        action: "polish",
        template: "Polish",
        providerId: "first",
      },
    ],
  });
  const mockedFetch = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mockedFetch);
  await expect(
    runAI(env, { action: "polish", selection: "fixture", promptId: "p" }),
  ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  expect(mockedFetch).not.toHaveBeenCalled();
});
