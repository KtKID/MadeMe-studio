import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerSchema } from "../../src/shared/contracts";
import { generateImage, listModels, runAI } from "../../src/server/ai/service";
import { writeSettings } from "../../src/server/settings";
import { loadPageData } from "../../src/server/page-data";
import { captureLogs } from "./log-capture";
import { fixtureEnv } from "./support";

let env: ReturnType<typeof fixtureEnv>;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const png64 = btoa(String.fromCharCode(...png));
const jpeg64 = btoa(String.fromCharCode(255, 216, 255, 224));
const mockFetch = vi.fn<typeof fetch>();
beforeEach(() => {
  env = fixtureEnv();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.DB.close();
});
async function configure(kind: string, extras: Record<string, unknown> = {}) {
  const provider = providerSchema.parse({
    id: "provider",
    name: "Fixture provider",
    kind,
    model: "text-model",
    temperature: 0.4,
    maxTokens: 1000,
    ...extras,
  });
  await writeSettings(env, { providers: [provider] });
  return provider;
}
function respond(data: unknown) {
  mockFetch.mockResolvedValueOnce(Response.json(data));
}
function sent() {
  const [url, init] = mockFetch.mock.calls[0];
  return {
    url: String(url),
    init: init!,
    body: JSON.parse(String(init?.body)),
    headers: new Headers(init?.headers),
  };
}

describe("新增提供商协议：官方格式 fixture，先测后实现", () => {
  it("Zod 接受 Gemini 并将文本和图像模型独立保存", async () => {
    const provider = await configure("gemini", {
      imageModel: "gemini-2.5-flash-image",
    });
    expect(provider).toMatchObject({
      kind: "gemini",
      model: "text-model",
      imageModel: "gemini-2.5-flash-image",
    });
  });
  it("OpenAI 使用选中配置的图像模型而不是覆盖成全局默认", async () => {
    env.OPENAI_API_KEY = "fixture-openai-key";
    env.IMAGE_MODEL = "fallback-model";
    await configure("openai", { imageModel: "gpt-image-2" });
    respond({ data: [{ b64_json: png64 }] });
    const image = await generateImage(env, {
      prompt: "Yellow notebook",
      providerId: "provider",
    });
    expect(sent().url).toBe("https://api.openai.com/v1/images/generations");
    expect(sent().body.model).toBe("gpt-image-2");
    expect(sent().body.output_format).toBe("png");
    expect(image.source).toBe("generated");
    expect(env.BUCKET.objects.size).toBe(1);
  });
  it("Gemini Nano Banana 用官方 generateContent 与请求头密钥，忽略思考预览图", async () => {
    Object.assign(env, { GEMINI_API_KEY: "fixture-gemini-key" });
    await configure("gemini", { imageModel: "gemini-2.5-flash-image" });
    respond({
      candidates: [
        {
          content: {
            parts: [
              {
                thought: true,
                inlineData: { mimeType: "image/jpeg", data: jpeg64 },
              },
              { text: "Here is your image" },
              { inlineData: { mimeType: "image/png", data: png64 } },
            ],
          },
        },
      ],
    });
    const image = await generateImage(env, {
      prompt: "Yellow notebook",
      providerId: "provider",
    });
    expect(sent().url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    expect(sent().url).not.toContain("fixture-gemini-key");
    expect(sent().headers.get("x-goog-api-key")).toBe("fixture-gemini-key");
    expect(sent().body.generationConfig.responseModalities).toEqual([
      "TEXT",
      "IMAGE",
    ]);
    expect(image.mime).toBe("image/png");
  });
  it("Gemini 文本使用原生 systemInstruction 和候选正文", async () => {
    Object.assign(env, { GEMINI_API_KEY: "fixture-gemini-key" });
    await configure("gemini", { model: "gemini-2.5-flash" });
    respond({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "not output" },
              { text: "Polished prose" },
            ],
          },
        },
      ],
    });
    expect(
      await runAI(env, {
        action: "polish",
        selection: "Original",
        providerId: "provider",
      }),
    ).toEqual({ text: "Polished prose" });
    expect(sent().body.systemInstruction.parts[0].text).toContain(
      "writing assistant",
    );
    expect(sent().body.contents[0].parts[0].text).toContain("Original");
  });
  it("OpenRouter 图像使用专用 API 和 base64 响应，不下载任意外部 URL", async () => {
    env.OPENROUTER_API_KEY = "fixture-openrouter-key";
    await configure("openrouter", { imageModel: "openai/gpt-image-2" });
    respond({ data: [{ b64_json: png64, media_type: "image/png" }] });
    await generateImage(env, {
      prompt: "Yellow notebook",
      providerId: "provider",
    });
    expect(sent().url).toBe("https://openrouter.ai/api/v1/images");
    expect(sent().body.model).toBe("openai/gpt-image-2");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("SiliconFlow 官方图像协议只下载白名单对象且不转发 API 密钥", async () => {
    env.SILICONFLOW_API_KEY = "fixture-silicon-key";
    await configure("siliconflow", {
      imageModel: "black-forest-labs/FLUX.1-schnell",
    });
    respond({
      images: [
        {
          url: "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/outputs/test.png?signature=fixture",
        },
      ],
    });
    mockFetch.mockResolvedValueOnce(
      new Response(png, { headers: { "Content-Type": "image/png" } }),
    );
    const image = await generateImage(env, {
      prompt: "Yellow notebook",
      providerId: "provider",
    });
    expect(sent().url).toBe("https://api.siliconflow.cn/v1/images/generations");
    expect(sent().body.image_size).toBe("1024x1024");
    expect(
      new Headers(mockFetch.mock.calls[1][1]?.headers).has("authorization"),
    ).toBe(false);
    expect(mockFetch.mock.calls[1][1]?.redirect).toBe("manual");
    expect(image.mime).toBe("image/png");
  });
  it.each([
    "http://127.0.0.1/image.png",
    "https://169.254.169.254/latest",
    "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com.evil.test/x.png",
  ])("拒绝上游诱导下载不安全地址 %s", async (url) => {
    env.SILICONFLOW_API_KEY = "fixture-silicon-key";
    await configure("siliconflow", { imageModel: "image-model" });
    respond({ images: [{ url }] });
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "UNSAFE_IMAGE_URL" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(env.BUCKET.objects.size).toBe(0);
  });
  it("Cloudflare 文本保持官方 OpenAI-compatible 端点", async () => {
    env.CLOUDFLARE_AI_TOKEN = "fixture-cloudflare-key";
    env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
    await configure("cloudflare", { model: "@cf/meta/llama-3.1-8b-instruct" });
    respond({ choices: [{ message: { content: "Cloudflare text" } }] });
    expect(
      await runAI(env, { action: "rewrite", selection: "Original" }),
    ).toEqual({ text: "Cloudflare text" });
    expect(sent().url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1/chat/completions`,
    );
  });
  it("Cloudflare 图像读取 run API 的 base64 result.image", async () => {
    env.CLOUDFLARE_AI_TOKEN = "fixture-cloudflare-key";
    env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
    await configure("cloudflare", {
      imageModel: "@cf/black-forest-labs/flux-1-schnell",
    });
    respond({ success: true, result: { image: jpeg64 } });
    const image = await generateImage(env, {
      prompt: "Yellow notebook",
      providerId: "provider",
    });
    expect(sent().url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    );
    expect(image.mime).toBe("image/jpeg");
  });
  it("Cloudflare 模型发现使用 models/search 并返回模型名称而不是内部 UUID", async () => {
    env.CLOUDFLARE_AI_TOKEN = "fixture-cloudflare-key";
    env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
    const p = await configure("cloudflare");
    respond({
      success: true,
      result: [{ id: "internal-uuid", name: "@cf/meta/llama-3.1-8b-instruct" }],
    });
    expect(await listModels(env, p)).toEqual([
      { id: "@cf/meta/llama-3.1-8b-instruct" },
    ]);
    expect(String(mockFetch.mock.calls[0][0])).toContain("/ai/models/search");
  });
  it("Gemini 模型发现规范化 models/ 前缀并过滤非生成模型", async () => {
    Object.assign(env, { GEMINI_API_KEY: "fixture-gemini-key" });
    const p = await configure("gemini");
    respond({
      models: [
        {
          name: "models/gemini-2.5-flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/embedding-model",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
    expect(await listModels(env, p)).toEqual([{ id: "gemini-2.5-flash" }]);
    expect(String(mockFetch.mock.calls[0][0])).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
  });
  it("Gemini 密钥让生图能力可用，响应仍不暴露密钥", async () => {
    Object.assign(env, { GEMINI_API_KEY: "fixture-gemini-key" });
    await configure("gemini", { imageModel: "gemini-2.5-flash-image" });
    const data = await loadPageData({
      request: new Request("https://site.test", {
        headers: { "oai-authenticated-user-id": "test-owner" },
      }),
      locals: { env },
    });
    expect(data.capabilities.imageConfigured).toBe(true);
    expect(data.settings.providers[0].configured).toBe(true);
    expect(JSON.stringify(data)).not.toContain("fixture-gemini-key");
  });
  it("上游异常不泄露响应正文中的密钥，且禁止重定向", async () => {
    env.OPENAI_API_KEY = "fixture-openai-key";
    await configure("openai");
    mockFetch.mockResolvedValueOnce(
      new Response("private-upstream-details", { status: 500 }),
    );
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sent().init.redirect).toBe("manual");
    expect(env.BUCKET.objects.size).toBe(0);
  });
  it("Workers 只接受 follow/manual：所有提供商请求都能通过 workerd 的 redirect 校验", async () => {
    // workerd 对 redirect:"error" 直接抛 TypeError；模拟同样的约束，防止 fetch 模拟掩盖平台差异。
    mockFetch.mockImplementation(async (_url, init) => {
      if (!["follow", "manual", undefined].includes(init?.redirect))
        throw new TypeError("Invalid redirect value");
      return Response.json({
        choices: [{ message: { content: "Workers ok" } }],
      });
    });
    env.OPENAI_API_KEY = "fixture-openai-key";
    await configure("openai");
    expect(
      await runAI(env, {
        action: "polish",
        selection: "Draft",
        providerId: "provider",
      }),
    ).toEqual({ text: "Workers ok" });
  });
  it("提供商 3xx 重定向视为失败、不跟随，并写入不含密钥的结构化日志", async () => {
    const logs = captureLogs();
    env.OPENAI_API_KEY = "fixture-openai-key";
    await configure("openai");
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.test/collect" },
      }),
    );
    await expect(
      runAI(env, {
        action: "polish",
        selection: "Draft",
        providerId: "provider",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(logs.find("ai.provider_http_error")[0]).toMatchObject({
      level: "error",
      host: "api.openai.com",
      httpStatus: 302,
      redirected: true,
    });
    expect(logs.raw()).not.toContain("fixture-openai-key");
    expect(logs.raw()).not.toContain("attacker.test");
  });
  it("提供商网络异常记录为 ai.provider_fetch_failed，不再静默", async () => {
    const logs = captureLogs();
    env.OPENAI_API_KEY = "fixture-openai-key";
    await configure("openai");
    mockFetch.mockRejectedValueOnce(new TypeError("network down"));
    await expect(
      runAI(env, {
        action: "polish",
        selection: "Draft",
        providerId: "provider",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(logs.find("ai.provider_fetch_failed")[0]).toMatchObject({
      level: "error",
      host: "api.openai.com",
      error: { name: "TypeError", message: "network down" },
    });
    expect(logs.raw()).not.toContain("fixture-openai-key");
  });
  it("上游 500 只记录状态码，不记录响应正文", async () => {
    const logs = captureLogs();
    env.OPENAI_API_KEY = "fixture-openai-key";
    await configure("openai");
    mockFetch.mockResolvedValueOnce(
      new Response("private-upstream-details", { status: 500 }),
    );
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(logs.find("ai.provider_http_error")[0]).toMatchObject({
      httpStatus: 500,
    });
    expect(logs.raw()).not.toContain("private-upstream-details");
  });
  it("生成图片下载遇到 3xx 视为失败并记录日志", async () => {
    const logs = captureLogs();
    env.SILICONFLOW_API_KEY = "fixture-silicon-key";
    await configure("siliconflow", {
      imageModel: "black-forest-labs/FLUX.1-schnell",
    });
    respond({
      images: [
        {
          url: "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/outputs/test.png?signature=fixture-signature",
        },
      ],
    });
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { Location: "https://attacker.test/x.png" },
      }),
    );
    await expect(
      generateImage(env, { prompt: "Yellow notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "IMAGE_DOWNLOAD_FAILED" });
    expect(mockFetch.mock.calls[1][1]?.redirect).toBe("manual");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(logs.find("ai.image_download_http_error")[0]).toMatchObject({
      level: "error",
      host: "sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com",
      httpStatus: 301,
    });
    expect(logs.raw()).not.toContain("fixture-signature");
    expect(env.BUCKET.objects.size).toBe(0);
  });
  it("没有密钥时在网络前失败，不伪造生图记录", async () => {
    await configure("openai");
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "IMAGE_NOT_CONFIGURED" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(env.BUCKET.objects.size).toBe(0);
  });
});

describe("提供商边界与失败路径", () => {
  it("拒绝OpenAI仅URL响应，不将未验证URL当作下载入口", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    await configure("openai");
    respond({ data: [{ url: "http://127.0.0.1/private" }] });
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("拒绝提供商返回的SVG，即使base64语法正确", async () => {
    env.OPENROUTER_API_KEY = "fixture-key";
    await configure("openrouter", { imageModel: "vector-model" });
    respond({
      data: [
        {
          b64_json: btoa('<svg onload="alert(1)"></svg>'),
          media_type: "image/svg+xml",
        },
      ],
    });
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE_RESPONSE" });
    expect(env.BUCKET.objects.size).toBe(0);
  });
  it("未知提供商ID不能回退到其他有费用提供商", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "missing" }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("Gemini模型路径不能注入目录或查询参数", async () => {
    env.GEMINI_API_KEY = "fixture-key";
    await configure("gemini", { imageModel: "../../private?key=attack" });
    await expect(
      generateImage(env, { prompt: "A notebook", providerId: "provider" }),
    ).rejects.toMatchObject({ code: "INVALID_MODEL" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("Cloudflare账户ID不合法时在请求前失败", async () => {
    env.CLOUDFLARE_AI_TOKEN = "fixture-key";
    env.CLOUDFLARE_ACCOUNT_ID = "../../private";
    await configure("cloudflare");
    await expect(
      runAI(env, { action: "polish", selection: "Draft" }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("不可解析JSON与超限响应都变成安全的502错误", async () => {
    env.OPENAI_API_KEY = "fixture-key";
    await configure("openai");
    mockFetch.mockResolvedValueOnce(
      new Response("invalid-secret-upstream-json"),
    );
    await expect(
      runAI(env, { action: "polish", selection: "Draft" }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    mockFetch.mockResolvedValueOnce(
      new Response("{}", { headers: { "Content-Length": "35000001" } }),
    );
    await expect(
      runAI(env, { action: "polish", selection: "Draft" }),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
  });
  it.each(["openai", "openrouter", "siliconflow"])(
    "%s标准模型列表只返回id，不透传其他上游字段",
    async (kind) => {
      Object.assign(env, {
        OPENAI_API_KEY: "fixture-key",
        OPENROUTER_API_KEY: "fixture-key",
        SILICONFLOW_API_KEY: "fixture-key",
      });
      const provider = await configure(kind);
      respond({
        data: [
          { id: "model-one", secret: "private-metadata" },
          { id: "model-two" },
        ],
      });
      expect(await listModels(env, provider)).toEqual([
        { id: "model-one" },
        { id: "model-two" },
      ]);
    },
  );
  it("下载白名单支持管理员明确域名，但不支持通配符或IP", async () => {
    env.SILICONFLOW_API_KEY = "fixture-key";
    env.SILICONFLOW_IMAGE_HOSTS = "images.siliconflow.cn,*.evil.test,127.0.0.1";
    await configure("siliconflow");
    respond({ images: [{ url: "https://images.siliconflow.cn/result.png" }] });
    mockFetch.mockResolvedValueOnce(new Response(png));
    expect(
      (
        await generateImage(env, {
          prompt: "A notebook",
          providerId: "provider",
        })
      ).mime,
    ).toBe("image/png");
  });
});
