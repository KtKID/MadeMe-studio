import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Post } from "../../src/shared/contracts";
import { D1PostRepository } from "../../src/server/content/repository";
import { PostService } from "../../src/server/content/service";
import { saveMedia } from "../../src/server/media/service";
import { handleAPI } from "../../src/server/api";
import { fixtureEnv } from "./support";
import { captureLogs } from "./log-capture";

let env: ReturnType<typeof fixtureEnv>;
let repo: D1PostRepository;
let service: PostService;
beforeEach(() => {
  env = fixtureEnv();
  repo = new D1PostRepository(env.DB);
  service = new PostService(repo);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.DB.close();
});
const png = () =>
  new Uint8Array(readFileSync("tests/fixtures/valid-image.png"));
async function upload() {
  return saveMedia(env, png(), { name: "a.png", mime: "image/png" });
}
async function post(id: string, patch: Partial<Post> = {}) {
  const draft: Post = {
    id,
    slug: id,
    title: `文章 ${id}`,
    excerpt: "",
    blocks: [],
    category: "",
    tags: [],
    coverImage: "",
    visibility: "draft",
    pinned: false,
    version: 1,
    publishedAt: null,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...patch,
  };
  await repo.create({
    draft,
    published: null,
    passwordHash: null,
    publishedPasswordHash: null,
  });
  return draft;
}
const imageBlock = (url: string) =>
  [
    {
      id: "b1",
      type: "image",
      props: { url, caption: "" },
      content: [],
      children: [],
    },
  ] as unknown as Post["blocks"];
async function del(
  id: string,
  options: { force?: boolean; owner?: boolean; origin?: string | null } = {},
) {
  const origin =
    options.origin === undefined ? "https://site.test" : options.origin;
  return handleAPI({
    request: new Request(
      `https://site.test/api/media/${id}${options.force ? "?force=1" : ""}`,
      {
        method: "DELETE",
        headers: {
          ...(options.owner === false
            ? {}
            : { "oai-authenticated-user-id": "test-owner" }),
          ...(origin ? { Origin: origin } : {}),
        },
      },
    ),
    locals: { env },
  });
}
const keys = (prefix: string) =>
  [...env.BUCKET.objects.keys()].filter((k) => k.startsWith(prefix));

describe("DELETE /api/media/:id", () => {
  it("未被引用：删除行、object_key 对象与 image-derivatives/v1/<id>/ 下全部衍生（含 s1/）", async () => {
    const media = await upload();
    const row = await env.DB.prepare("SELECT object_key FROM media WHERE id=?")
      .bind(media.id)
      .first<{ object_key: string }>();
    // 模拟旧路径与 s1/ 两套衍生 + 另一媒体的同前缀干扰对象
    for (const key of [
      `image-derivatives/v1/${media.id}/manifest.json`,
      `image-derivatives/v1/${media.id}/h/g/480.webp`,
      `image-derivatives/v1/${media.id}/s1/manifest.json`,
      `image-derivatives/v1/${media.id}/s1/h/g/480.webp`,
      `image-derivatives/v1/${media.id}x/keep.webp`,
    ])
      await env.BUCKET.put(key, new Uint8Array([1]));
    const logs = captureLogs();
    const response = await del(media.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, clearedCovers: [] });
    expect(
      await env.DB.prepare("SELECT id FROM media WHERE id=?")
        .bind(media.id)
        .first(),
    ).toBeNull();
    expect(env.BUCKET.objects.has(row!.object_key)).toBe(false);
    expect(keys(`image-derivatives/v1/${media.id}/`)).toEqual([]);
    expect(keys(`image-derivatives/v1/${media.id}x/`)).toHaveLength(1);
    expect(logs.records()).toContainEqual(
      expect.objectContaining({ event: "media.deleted", derivatives: 4 }),
    );
  });

  it("被草稿正文或封面引用：409 MEDIA_IN_USE 列出文章，什么都不删", async () => {
    const media = await upload();
    await post("p-cover", { coverImage: media.url });
    await post("p-body", { blocks: imageBlock(media.url) });
    const response = await del(media.id);
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string; details: { posts: unknown[] } };
    };
    expect(body.error.code).toBe("MEDIA_IN_USE");
    expect(body.error.details.posts).toEqual([
      expect.objectContaining({
        postId: "p-body",
        cover: false,
        body: true,
        published: false,
        trashed: false,
      }),
      expect.objectContaining({
        postId: "p-cover",
        title: "文章 p-cover",
        cover: true,
        body: false,
      }),
    ]);
    expect(
      await env.DB.prepare("SELECT id FROM media WHERE id=?")
        .bind(media.id)
        .first(),
    ).not.toBeNull();
  });

  it("force=1：只清封面（草稿 + 已发布快照，版本 +1），正文引用不动，然后删除", async () => {
    const media = await upload();
    const p = await post("p-live", {
      coverImage: media.url,
      blocks: imageBlock(media.url),
    });
    await service.publish(p.id, { version: 1 });
    await post("p-trash", { coverImage: media.url });
    await service.remove("p-trash", 1);
    const response = await del(media.id, { force: true });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { clearedCovers: unknown[] };
    expect(result.clearedCovers).toEqual(
      expect.arrayContaining([
        { postId: "p-live", previousVersion: 2, version: 3 },
        { postId: "p-trash", previousVersion: 2, version: 3 },
      ]),
    );
    const live = (await repo.get("p-live"))!;
    expect(live.draft.coverImage).toBe("");
    expect(live.published!.coverImage).toBe("");
    expect(JSON.stringify(live.draft.blocks)).toContain(media.url);
    expect(JSON.stringify(live.published!.blocks)).toContain(media.url);
    expect((await repo.get("p-trash"))!.draft.coverImage).toBe("");
    expect(
      await env.DB.prepare("SELECT id FROM media WHERE id=?")
        .bind(media.id)
        .first(),
    ).toBeNull();
  });

  it("对象删除失败：行已删，记录孤儿日志，仍返回成功", async () => {
    const media = await upload();
    vi.spyOn(env.BUCKET, "delete").mockRejectedValueOnce(new Error("r2 down"));
    const logs = captureLogs();
    const response = await del(media.id);
    expect(response.status).toBe(200);
    expect(logs.records()).toContainEqual(
      expect.objectContaining({ event: "media.delete_orphan_object" }),
    );
  });

  it("权限与同源：未登录 401/403，跨站 Origin 被拒，未知 ID 404", async () => {
    const media = await upload();
    expect([401, 403]).toContain(
      (await del(media.id, { owner: false })).status,
    );
    expect((await del(media.id, { origin: "https://evil.test" })).status).toBe(
      403,
    );
    expect((await del("missing-id")).status).toBe(404);
    expect(
      await env.DB.prepare("SELECT id FROM media WHERE id=?")
        .bind(media.id)
        .first(),
    ).not.toBeNull();
  });
});
