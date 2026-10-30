import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { handleAPI } from "../../src/server/api";
import { createToken } from "../../src/server/tokens";
import {
  LEGACY_POST_KEYS,
  POST_SCHEMA_ACCEPT,
  postMutationResponseSchema,
  postSchema,
} from "../../src/shared/contracts";
import { fixtureEnv, blocks } from "./support";

let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => env.DB.close());

// 已发出的 0.1.0 集成包读取协议（strict），见 tests/integration-compat.test.ts。
const legacyClient = z
  .object({
    post: z.union([
      postSchema
        .pick(
          Object.fromEntries(LEGACY_POST_KEYS.map((k) => [k, true])) as {
            [K in (typeof LEGACY_POST_KEYS)[number]]: true;
          },
        )
        .strict(),
      postSchema.pick({ id: true, version: true }).strict(),
    ]),
  })
  .strict();
const cover = {
  aspect: "16:9",
  fit: "cover",
  focusX: 50,
  focusY: 0,
  zoom: 1,
} as const;

async function call(
  path: string,
  method: string,
  body: unknown,
  auth: { token?: string; accept?: string } = {},
): Promise<Omit<Response, "json"> & { json(): Promise<any> }> {
  return handleAPI({
    request: new Request(`https://site.test/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth.token
          ? { Authorization: `Bearer ${auth.token}` }
          : {
              Origin: "https://site.test",
              "oai-authenticated-user-id": "test-owner",
            }),
        ...(auth.accept ? { Accept: auth.accept } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: { env },
  });
}
async function ownerPostWithCover() {
  const res = await call("posts", "POST", {
    title: "带封面",
    blocks,
    coverImage: "https://img.test/a.png",
    coverSettings: cover,
  });
  expect(res.status).toBe(201);
  return (await res.json()).post as { id: string; version: number };
}
async function token(scopes: string[]) {
  return (
    await createToken(env, {
      name: "integration",
      scopes: scopes as never,
      expiresInDays: 1,
    })
  ).token;
}

it("旧客户端（不声明版本）用读写 Token 发布含封面设置的文章：返回旧格式，旧 strict 协议可解析", async () => {
  const p = await ownerPostWithCover();
  const t = await token(["posts:read", "posts:write", "posts:publish"]);
  const res = await call(
    `posts/${p.id}/publish`,
    "POST",
    { version: p.version, visibility: "public" },
    { token: t, accept: "application/json" },
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.post).not.toHaveProperty("coverSettings");
  expect(json.post).not.toHaveProperty("hasUnpublishedChanges");
  expect(Object.keys(json.post).sort()).toEqual([...LEGACY_POST_KEYS].sort());
  expect(legacyClient.safeParse(json).success).toBe(true);
  // 只是响应不带，数据本身未丢失。
  const owner = await (await call(`posts/${p.id}`, "GET", undefined)).json();
  expect(owner.post.coverSettings).toEqual(cover);
});

it("旧客户端新建草稿、GET 单篇与列表都返回旧格式", async () => {
  const p = await ownerPostWithCover();
  const t = await token(["posts:read", "posts:write"]);
  const created = await (
    await call(
      "posts",
      "POST",
      { title: "新稿", markdown: "hi", visibility: "draft" },
      { token: t },
    )
  ).json();
  expect(legacyClient.safeParse(created).success).toBe(true);
  const one = await (
    await call(`posts/${p.id}`, "GET", undefined, { token: t })
  ).json();
  expect(legacyClient.safeParse(one).success).toBe(true);
  expect(one.post).not.toHaveProperty("coverSettings");
  const list = await (
    await call("posts", "GET", undefined, { token: t })
  ).json();
  expect(list.posts.length).toBeGreaterThan(0);
  for (const item of list.posts)
    expect(item).not.toHaveProperty("coverSettings");
});

it("声明 mademe-post-schema=2 的新客户端拿到完整字段（含 coverSettings）", async () => {
  const p = await ownerPostWithCover();
  const t = await token(["posts:read", "posts:write", "posts:publish"]);
  const res = await call(
    `posts/${p.id}/publish`,
    "POST",
    { version: p.version, visibility: "public" },
    { token: t, accept: POST_SCHEMA_ACCEPT },
  );
  const json = await res.json();
  expect(json.post.coverSettings).toEqual(cover);
  expect(json.post.hasUnpublishedChanges).toBe(false);
  expect(postMutationResponseSchema.safeParse(json).success).toBe(true);
  const one = await (
    await call(`posts/${p.id}`, "GET", undefined, {
      token: t,
      accept: POST_SCHEMA_ACCEPT,
    })
  ).json();
  expect(one.post.coverSettings).toEqual(cover);
});

it("站内作者会话不受影响：始终完整字段", async () => {
  const p = await ownerPostWithCover();
  const one = await (await call(`posts/${p.id}`, "GET", undefined)).json();
  expect(one.post.coverSettings).toEqual(cover);
});

it("仅写 Token 仍只拿 {id, version} 回执", async () => {
  const t = await token(["posts:write"]);
  const res = await call(
    "posts",
    "POST",
    { title: "回执", markdown: "x", visibility: "draft" },
    { token: t },
  );
  const json = await res.json();
  expect(Object.keys(json.post).sort()).toEqual(["id", "version"]);
});

it("服务端输入校验保持 strict：未知字段与封面设置里的多余键都被拒绝", async () => {
  const t = await token(["posts:write"]);
  const extra = await call(
    "posts",
    "POST",
    { title: "x", markdown: "x", visibility: "draft", futureField: 1 },
    { token: t },
  );
  expect(extra.status).toBe(422);
  const nested = await call(
    "posts",
    "POST",
    { title: "x", blocks, coverSettings: { ...cover, fill: "#000" } },
    { token: t },
  );
  expect(nested.status).toBe(422);
});
