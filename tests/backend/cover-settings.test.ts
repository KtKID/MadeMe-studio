import { afterEach, beforeEach, expect, it } from "vitest";
import { handleAPI } from "../../src/server/api";
import {
  postResponseSchema,
  postsResponseSchema,
} from "../../src/shared/contracts";
import { D1PostRepository } from "../../src/server/content/repository";
import { publicationStatus } from "../../src/modules/publication-status/server";
import { DEFAULT_COVER_SETTINGS } from "../../src/modules/cover/contracts";
import { fixtureEnv, blocks } from "./support";

let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => env.DB.close());
async function request(path: string, method = "GET", body?: unknown, owner = true) {
  return handleAPI({
    request: new Request(`https://site.test/api/${path}`, {
      method,
      headers: {
        Origin: "https://site.test",
        "Content-Type": "application/json",
        ...(owner ? { "oai-authenticated-user-id": "test-owner" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: { env },
  });
}
async function write(path: string, method: string, body: unknown) {
  const response = await request(path, method, body);
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return postResponseSchema.parse(await response.json()).post;
}
const square = {
  aspect: "1:1",
  fit: "cover",
  focusX: 10,
  focusY: 80,
  zoom: 1.5,
} as const;

it("封面设置随草稿保存、重新载入、发布快照、工作台摘要与公开列表保留", async () => {
  let p = await write("posts", "POST", {
    title: "封面",
    blocks,
    coverImage: "https://img.test/a.png",
    coverSettings: square,
  });
  expect(p.coverSettings).toEqual(square);
  const reloaded = postResponseSchema.parse(
    await (await request(`posts/${p.id}`)).json(),
  ).post;
  expect(reloaded.coverSettings).toEqual(square);
  p = await write(`posts/${p.id}/publish`, "POST", {
    version: p.version,
    visibility: "public",
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  const owner = postsResponseSchema.parse(await (await request("posts")).json());
  expect(owner.posts[0].coverSettings).toEqual(square);
  const anonymous = postsResponseSchema.parse(
    await (await request("posts", "GET", undefined, false)).json(),
  );
  expect(anonymous.posts[0].coverSettings).toEqual(square);
  const summaries = await new D1PostRepository(env.DB).listSummaries();
  expect(summaries[0].coverSettings).toEqual(square);
});

it("只改封面展示方式即标记待发布；改回后恢复；重新发布后线上快照更新", async () => {
  let p = await write("posts", "POST", {
    title: "封面",
    blocks,
    coverImage: "https://img.test/a.png",
    coverSettings: square,
  });
  p = await write(`posts/${p.id}/publish`, "POST", {
    version: p.version,
    visibility: "public",
  });
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: { ...square, aspect: "16:9" },
  });
  expect(p.hasUnpublishedChanges).toBe(true);
  const live = postResponseSchema.parse(
    await (await request(`posts/${p.id}`, "GET", undefined, false)).json(),
  ).post;
  expect(live.coverSettings).toEqual(square);
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: square,
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: { ...square, fit: "contain" },
  });
  p = await write(`posts/${p.id}/publish`, "POST", { version: p.version });
  const republished = postResponseSchema.parse(
    await (await request(`posts/${p.id}`, "GET", undefined, false)).json(),
  ).post;
  expect(republished.coverSettings).toEqual({ ...square, fit: "contain" });
});

it("旧文章没有 coverSettings：保存默认值不会被误判为待发布；无封面时设置不参与比较", async () => {
  let p = await write("posts", "POST", {
    title: "旧文",
    blocks,
    coverImage: "https://img.test/a.png",
  });
  expect(p).not.toHaveProperty("coverSettings");
  p = await write(`posts/${p.id}/publish`, "POST", {
    version: p.version,
    visibility: "public",
  });
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: DEFAULT_COVER_SETTINGS,
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  const draft = { ...p, coverImage: "" };
  expect(
    publicationStatus({
      draft: { ...draft, coverSettings: square },
      published: { ...draft, coverSettings: undefined },
      passwordHash: null,
      publishedPasswordHash: null,
    }).hasUnpublishedChanges,
  ).toBe(false);
});

it("非法封面设置被拒绝，不写入", async () => {
  const p = await write("posts", "POST", { title: "x", blocks });
  const response = await request(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: { ...square, zoom: 10 },
  });
  expect(response.status).toBe(422);
  const bad = await request(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: { ...square, aspect: "21:9" },
  });
  expect(bad.status).toBe(422);
});

it("通过接口更换封面图但未给设置时，只重置位置与缩放", async () => {
  let p = await write("posts", "POST", {
    title: "x",
    blocks,
    coverImage: "https://img.test/a.png",
    coverSettings: square,
  });
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverImage: "https://img.test/b.png",
  });
  expect(p.coverSettings).toEqual({
    ...square,
    focusX: 50,
    focusY: 50,
    zoom: 1,
  });
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    title: "只改标题",
  });
  expect(p.coverSettings).toEqual({ ...square, focusX: 50, focusY: 50, zoom: 1 });
});

it("恢复历史版本带回当时的封面设置", async () => {
  let p = await write("posts", "POST", {
    title: "x",
    blocks,
    coverImage: "https://img.test/a.png",
    coverSettings: square,
  });
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    coverSettings: { ...square, aspect: "4:3" },
  });
  p = await write(`posts/${p.id}/revisions/1/restore`, "POST", {
    version: p.version,
  });
  expect(p.coverSettings).toEqual(square);
});
