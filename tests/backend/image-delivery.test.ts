import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fixtureEnv } from "./support";
import { saveMedia } from "../../src/server/media/service";
import { serveImageVariant } from "../../src/server/media/image-delivery";
import { PostService } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
import type { Identity } from "../../src/server/auth/identity";
import { handleAPI } from "../../src/server/api";
const { encode } = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock("../../src/server/media/image-encoder", () => ({
  encodeVariants: encode,
}));
let env: ReturnType<typeof fixtureEnv>;
const owner: Identity = {
  owner: true,
  trustedIdentity: "test-owner",
  scopes: [],
};
const guest: Identity = { owner: false, trustedIdentity: null, scopes: [] };
const png = new Uint8Array(readFileSync("tests/fixtures/valid-image.png"));
beforeEach(() => {
  env = fixtureEnv();
  encode.mockReset().mockResolvedValue(
    [480, 960].map((target) => ({
      target,
      width: target,
      height: (target * 2) / 3,
      data: new Uint8Array([target / 480, 2, 3, 4]),
    })),
  );
});
afterEach(() => {
  env.DB.close();
  vi.unstubAllGlobals();
});
const get = (
  id: string,
  publicOnly = true,
  identity = guest,
  extra: RequestInit = {},
) =>
  serveImageVariant(
    new Request(
      `https://site.test/api/images/${publicOnly ? "public" : "private"}/v1/${id}/960.webp`,
      extra,
    ),
    env,
    identity,
    { id, width: 960, publicOnly },
  );
async function setup(
  visibility: "public" | "unlisted" | "password" = "public",
) {
  const media = await saveMedia(env, png, {
    name: "image.png",
    mime: "image/png",
  });
  const posts = new PostService(new D1PostRepository(env.DB));
  const draft = await posts.create({
    title: "Image",
    coverImage: media.url,
    blocks: [],
  });
  const post = await posts.publish(draft.id, {
    version: 1,
    visibility,
    ...(visibility === "password" ? { password: "only-for-test" } : {}),
  });
  return { media, posts, post };
}
it("私有/无引用图片连作者也不能走公开路径，拒绝在 R2/处理之前", async () => {
  const media = await saveMedia(env, png, {
    name: "draft.png",
    mime: "image/png",
  });
  await expect(get(media.id, true, owner)).rejects.toMatchObject({
    status: 404,
  });
  expect(encode).not.toHaveBeenCalled();
  await expect(get(media.id, false, guest)).rejects.toMatchObject({
    status: 404,
  });
  const response = await get(media.id, false, owner);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it.each(["password", "unlisted"] as const)(
  "%s 不能进入公开缓存",
  async (visibility) => {
    const { media } = await setup(visibility);
    await expect(get(media.id, true, owner)).rejects.toMatchObject({
      status: 404,
    });
    expect(encode).not.toHaveBeenCalled();
  },
);
it("公开衍生与身份无关、短浏览器TTL、ETag；原图字节不变", async () => {
  const { media } = await setup();
  const response = await get(media.id);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Cache-Control")).toBe(
    "public, max-age=60, s-maxage=0, must-revalidate",
  );
  expect(response.headers.has("Vary")).toBe(false);
  expect(response.headers.has("Set-Cookie")).toBe(false);
  expect(env.BUCKET.objects.get(`media/${media.id}`)).toEqual(png);
  const repeated = await get(media.id, true, owner, {
    headers: { "If-None-Match": response.headers.get("ETag")! },
  });
  expect(repeated.status).toBe(304);
  expect(await repeated.text()).toBe("");
  expect(encode).toHaveBeenCalledTimes(1);
});
it("撤回/换封面后，即使有缓存和ETag也必须重新授权", async () => {
  const { media, posts, post } = await setup();
  const etag = (await get(media.id)).headers.get("ETag")!;
  await posts.unpublish(post.id, post.version);
  for (const method of ["GET", "HEAD"])
    await expect(
      get(media.id, true, guest, {
        method,
        headers: { "If-None-Match": etag },
      }),
    ).rejects.toMatchObject({ status: 404 });
  expect(encode).toHaveBeenCalledTimes(1);
});
it("旧图片仍被另一个公开快照引用时保留访问；最后一次引用移除后拒绝", async () => {
  const { media, posts, post } = await setup();
  const other = await posts.create({
    title: "Other",
    coverImage: media.url,
    blocks: [],
  });
  const published = await posts.publish(other.id, {
    version: 1,
    visibility: "public",
  });
  const changed = await posts.update(post.id, {
    version: post.version,
    coverImage: "",
  });
  await posts.publish(post.id, {
    version: changed.version,
    visibility: "public",
  });
  expect((await get(media.id)).status).toBe(200);
  await posts.remove(published.id, published.version);
  await expect(get(media.id)).rejects.toMatchObject({ status: 404 });
});
it("并发只生成一套；部分写入失败清理衍生，不删原图，允许重试", async () => {
  const { media } = await setup();
  const originalPut = env.BUCKET.put.bind(env.BUCKET);
  let failed = false;
  env.BUCKET.put = async (key, value) => {
    if (key.endsWith("960.webp") && !failed) {
      failed = true;
      throw new Error("test storage failure");
    }
    await originalPut(key, value);
  };
  const failedRequests = await Promise.allSettled([
    get(media.id),
    get(media.id),
  ]);
  expect(failedRequests.every((r) => r.status === "rejected")).toBe(true);
  expect(encode).toHaveBeenCalledTimes(1);
  expect([...env.BUCKET.objects.keys()]).toEqual([`media/${media.id}`]);
  const results = await Promise.all([get(media.id), get(media.id)]);
  expect(results.every((r) => r.status === 200)).toBe(true);
  expect(encode).toHaveBeenCalledTimes(2);
});

it("边缘命中之前再次检查公开授权，缓存键不含Cookie，公开API不消费身份令牌", async () => {
  const { media, posts, post } = await setup();
  let cached: Response | undefined;
  const match = vi.fn(async () => cached?.clone());
  const put = vi.fn(async (key: Request, value: Response) => {
    expect(key.headers.has("Cookie")).toBe(false);
    cached = value;
  });
  vi.stubGlobal("caches", { default: { match, put } });
  const a = await get(media.id);
  await a.arrayBuffer();
  const response = await handleAPI({
    request: new Request(
      `https://site.test/api/images/public/v1/${media.id}/960.webp`,
      {
        headers: { Authorization: "invalid credential", Cookie: "test-cookie" },
      },
    ),
    locals: { env },
  });
  expect(response.status).toBe(200);
  expect(encode).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(1);
  const before = match.mock.calls.length;
  await posts.unpublish(post.id, post.version);
  await expect(get(media.id)).rejects.toMatchObject({ status: 404 });
  expect(match).toHaveBeenCalledTimes(before);
});

it("manifest 写入结果不确定时不误删已提交批次，下一次先回读核对", async () => {
  const { media } = await setup();
  const put = env.BUCKET.put.bind(env.BUCKET);
  let failed = false;
  env.BUCKET.put = async (key, value) => {
    await put(key, value);
    if (key.endsWith("manifest.json") && !failed) {
      failed = true;
      throw new Error("test lost acknowledgement");
    }
  };
  await expect(get(media.id)).rejects.toMatchObject({ status: 503 });
  expect(env.BUCKET.objects.has(`media/${media.id}`)).toBe(true);
  expect((await get(media.id)).status).toBe(200);
  expect(encode).toHaveBeenCalledTimes(1);
});
