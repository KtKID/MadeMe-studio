import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { handleAPI } from "../../src/server/api";
import { fixtureEnv, blocks } from "./support";
import type {
  Post,
  Media,
  Settings,
  Capabilities,
  APIToken,
} from "../../src/shared/contracts";
/** 响应结构由每个用例断言；此类型避免 Workers 的 unknown JSON 签名污染测试代码。 */
type TestResponse = Omit<Response, "json"> & {
  json(): Promise<{
    post: Post;
    posts: Post[];
    settings: Settings;
    capabilities: Capabilities;
    media: Media;
    token: string;
    id: string;
    tokens: APIToken[];
    error: { code: string };
  }>;
};
let env: ReturnType<typeof fixtureEnv>;
let server: Server;
let origin: string;
/** 启动真实本地 HTTP 服务，覆盖 Request/Response、身份、数据库与对象存储的组合边界。 */
beforeEach(async () => {
  env = fixtureEnv();
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const response = await handleAPI({
      request: new Request(`${origin}${req.url}`, {
        method: req.method,
        headers: req.headers as HeadersInit,
        ...(body ? { body } : {}),
      }),
      locals: { env },
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  env.DB.close();
});
async function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    owner?: boolean;
    headers?: Record<string, string>;
    sameOrigin?: boolean;
  } = {},
) {
  const headers: Record<string, string> = {
    ...(options.owner ? { "oai-authenticated-user-id": "test-owner" } : {}),
    ...(options.sameOrigin === false ? {} : { Origin: origin }),
    ...options.headers,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${origin}/api/${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  return response as TestResponse;
}
async function newPost(title = "Article") {
  const response = await call("posts", {
    method: "POST",
    owner: true,
    body: { title, blocks },
  });
  expect(response.status).toBe(201);
  return (await response.json()).post;
}
describe("HTTP E2E：作者写作与公开读取", () => {
  it("冒烟：默认空站可读，写入持久化且重读成功，未知字段被 Zod 拒绝", async () => {
    const bootstrap = await (await call("bootstrap")).json();
    expect(bootstrap.posts).toEqual([]);
    expect(bootstrap.capabilities.authenticated).toBe(false);
    const post = await newPost();
    expect(
      (await (await call(`posts/${post.id}`, { owner: true })).json()).post
        .title,
    ).toBe("Article");
    const invalid = await call("posts", {
      method: "POST",
      owner: true,
      body: { title: "Bad", blocks, privateKey: "never-accepted" },
    });
    expect(invalid.status).toBe(422);
  });
  it("拒绝匿名、非拥有者、跨站以及没有 Origin 的浏览器写入", async () => {
    expect(
      (await call("posts", { method: "POST", body: { title: "No", blocks } }))
        .status,
    ).toBe(401);
    expect(
      (
        await call("posts", {
          method: "POST",
          body: { title: "No", blocks },
          headers: { "oai-authenticated-user-id": "stranger" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("posts", {
          method: "POST",
          owner: true,
          body: { title: "No", blocks },
          headers: { Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("posts", {
          method: "POST",
          owner: true,
          body: { title: "No", blocks },
          sameOrigin: false,
        })
      ).status,
    ).toBe(403);
  });
  it("发布后继续编辑不改变访客内容，过期保存返回 409", async () => {
    let post = await newPost("Published title");
    post = (
      await (
        await call(`posts/${post.id}/publish`, {
          method: "POST",
          owner: true,
          body: { version: post.version },
        })
      ).json()
    ).post;
    expect(
      (
        await call(`posts/${post.id}`, {
          method: "PATCH",
          owner: true,
          body: { version: post.version, title: "Draft title" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`posts/${post.id}`, {
          method: "PATCH",
          owner: true,
          body: { version: post.version, title: "Stale" },
        })
      ).status,
    ).toBe(409);
    expect((await (await call(`posts/${post.id}`)).json()).post.title).toBe(
      "Published title",
    );
    expect((await (await call("posts")).json()).posts[0].title).toBe(
      "Published title",
    );
    expect((await call(`posts/${post.id}/revisions`)).status).toBe(401);
  });
  it("密码解锁、未列出内容与软删除均由服务器检查", async () => {
    let post = await newPost("Secret");
    post = (
      await (
        await call(`posts/${post.id}/publish`, {
          method: "POST",
          owner: true,
          body: {
            version: 1,
            visibility: "password",
            password: "private-password",
          },
        })
      ).json()
    ).post;
    expect((await call(`posts/${post.id}`)).status).toBe(404);
    expect((await (await call("posts")).json()).posts).toEqual([]);
    expect(
      (
        await call(`posts/${post.slug}/unlock`, {
          method: "POST",
          body: { password: "wrong" },
        })
      ).status,
    ).toBe(403);
    const unlocked = await call(`posts/${post.slug}/unlock`, {
      method: "POST",
      body: { password: "private-password" },
    });
    expect(unlocked.status).toBe(200);
    expect(unlocked.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = unlocked.headers.get("set-cookie")!.split(";")[0];
    expect(
      (await call(`posts/${post.id}`, { headers: { Cookie: cookie } })).status,
    ).toBe(200);
    post = (
      await (
        await call(`posts/${post.id}`, {
          method: "DELETE",
          owner: true,
          body: { version: post.version },
        })
      ).json()
    ).post;
    expect(
      (await call(`posts/${post.id}`, { headers: { Cookie: cookie } })).status,
    ).toBe(404);
    expect(
      (
        await call(`posts/${post.id}/restore`, {
          method: "POST",
          owner: true,
          body: { version: post.version },
        })
      ).status,
    ).toBe(200);
  });
  it("真实文件上传、公开快照引用与删除状态共同控制媒体访问", async () => {
    let post = await newPost();
    const form = new FormData();
    form.append(
      "file",
      new Blob(
        [new Uint8Array(readFileSync("tests/fixtures/valid-image.png"))],
        {
          type: "image/png",
        },
      ),
      "image.png",
    );
    form.append("postId", post.id);
    const uploaded = await fetch(`${origin}/api/media`, {
      method: "POST",
      headers: { Origin: origin, "oai-authenticated-user-id": "test-owner" },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const media = (await (uploaded as TestResponse).json()).media;
    expect(env.BUCKET.objects.size).toBe(1);
    // 只存 960 宽 WebP，不保留原 PNG。
    expect(media.mime).toBe("image/webp");
    expect(env.BUCKET.objects.has(`media/${media.id}.webp`)).toBe(true);
    expect((await call(`files/${media.id}`)).status).toBe(404);
    expect((await call(`files/${media.id}`, { owner: true })).status).toBe(200);
    post = (
      await (
        await call(`posts/${post.id}`, {
          method: "PATCH",
          owner: true,
          body: { version: 1, coverImage: media.url },
        })
      ).json()
    ).post;
    post = (
      await (
        await call(`posts/${post.id}/publish`, {
          method: "POST",
          owner: true,
          body: { version: post.version },
        })
      ).json()
    ).post;
    const file = await call(`files/${media.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    await call(`posts/${post.id}`, {
      method: "DELETE",
      owner: true,
      body: { version: post.version },
    });
    expect((await call(`files/${media.id}`)).status).toBe(404);
  });
  it("API token 只显示一次、按 scope 限权、支持无 cookie CORS、可撤销", async () => {
    const minted = await call("tokens", {
      method: "POST",
      owner: true,
      body: { name: "Clipper", scopes: ["posts:write"], expiresInDays: 1 },
    });
    expect(minted.status).toBe(201);
    const token = await minted.json();
    expect(token.token).toMatch(/^mm_[a-f0-9]{64}$/);
    const listed = await (await call("tokens", { owner: true })).json();
    expect(JSON.stringify(listed)).not.toContain(token.token);
    const headers = {
      Authorization: `Bearer ${token.token}`,
      Origin: "chrome-extension://test",
    };
    const created = await call("posts", {
      method: "POST",
      headers,
      body: {
        title: "Clipped",
        markdown: "# Heading\n\nA **bold** idea.",
        visibility: "draft",
      },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("access-control-allow-origin")).toBe("*");
    const post = (await created.json()).post;
    expect(Object.keys(post).sort()).toEqual(["id", "version"]);
    expect(
      (await (await call(`posts/${post.id}`, { owner: true })).json()).post
        .blocks[0].type,
    ).toBe("heading");
    expect(
      (
        await call(`posts/${post.id}/publish`, {
          method: "POST",
          headers,
          body: { version: post.version },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("settings", {
          method: "PATCH",
          headers,
          body: { siteTitle: "Hacked" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`tokens/${token.id}`, { method: "DELETE", owner: true }))
        .status,
    ).toBe(200);
    expect(
      (
        await call("posts", {
          method: "POST",
          headers,
          body: { title: "Revoked", blocks },
        })
      ).status,
    ).toBe(401);
  });
  it("仅草稿写入令牌不能借恢复操作重新发布已删除文章", async () => {
    const draft = await newPost("Published then deleted");
    await call(`posts/${draft.id}/publish`, {
      method: "POST",
      owner: true,
      body: { version: 1 },
    });
    await call(`posts/${draft.id}`, {
      method: "DELETE",
      owner: true,
      body: { version: 2 },
    });
    const token = await (
      await call("tokens", {
        method: "POST",
        owner: true,
        body: { name: "Draft only", scopes: ["posts:write"] },
      })
    ).json();
    const restored = await call(`posts/${draft.id}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}` },
      body: { version: 3 },
    });
    expect(restored.status).toBe(403);
    expect((await call(`posts/${draft.id}`)).status).toBe(404);
  });
  it("没有运行时密钥时 AI 和生图返回明确配置错误，不制造成功结果", async () => {
    const ai = await call("ai", {
      method: "POST",
      owner: true,
      body: { action: "polish", selection: "Hello" },
    });
    expect(ai.status).toBe(503);
    expect((await ai.json()).error.code).toBe("AI_NOT_CONFIGURED");
    const image = await call("images/generate", {
      method: "POST",
      owner: true,
      body: { prompt: "A cloud" },
    });
    expect(image.status).toBe(503);
    expect((await image.json()).error.code).toBe("IMAGE_NOT_CONFIGURED");
    expect(env.BUCKET.objects.size).toBe(0);
  });
  it("公共设置不泄露自定义代码或 Prompt，凭据不允许从配置协议写入", async () => {
    const response = await call("settings", {
      method: "PATCH",
      owner: true,
      body: {
        siteTitle: "Mine",
        customCode: "<script>private()</script>",
        prompts: [
          {
            id: "private",
            name: "Private",
            action: "polish",
            template: "Private prompt",
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const settings = (await (await call("settings")).json()).settings;
    expect(settings.siteTitle).toBe("Mine");
    expect(settings.customCode).toBe("");
    expect(settings.prompts).toEqual([]);
    expect(
      (
        await call("settings", {
          method: "PATCH",
          owner: true,
          body: { OPENAI_API_KEY: "not-accepted" },
        })
      ).status,
    ).toBe(422);
  });
});
