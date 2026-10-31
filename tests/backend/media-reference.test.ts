import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import type { Post } from "../../src/shared/contracts";
import { D1PostRepository } from "../../src/server/content/repository";
import { PostService } from "../../src/server/content/service";
import { saveMedia } from "../../src/server/media/service";
import { handleAPI } from "../../src/server/api";
import { hashPassword } from "../../src/server/auth/crypto";
import { fixtureEnv } from "./support";
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
/** 构造带正确 CRC 和压缩像素的有效 PNG，避免只用文件头测试对象读取。 */
function png() {
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const tag = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
    return Buffer.concat([length, tag, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 180, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function draft(
  id: string,
  coverImage = "",
  passwordHash: string | null = null,
) {
  const post: Post = {
    id,
    slug: id,
    title: id,
    excerpt: "",
    blocks: [],
    category: "",
    tags: [],
    coverImage,
    visibility: "draft",
    pinned: false,
    version: 1,
    publishedAt: null,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  await repo.create({
    draft: post,
    published: null,
    passwordHash,
    publishedPasswordHash: null,
  });
  return post;
}
async function read(path: string, cookie?: string) {
  return handleAPI({
    request: new Request(`https://site.test${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    locals: { env },
  });
}
describe("媒体引用查询回归：独立于首页列表截断", () => {
  it("1000篇更新草稿不能遮蔽旧公开文章的合法图片", async () => {
    const bytes = png();
    const media = await saveMedia(env, bytes, {
      name: "valid.png",
      mime: "image/png",
    });
    const post = await draft("old-public", media.url);
    await service.publish(post.id, { version: 1 });
    await env.DB.prepare("UPDATE posts SET updated_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", post.id)
      .run();
    for (let i = 0; i < 1000; i++)
      await draft(`new-draft-${String(i).padStart(4, "0")}`);
    expect((await repo.list()).some((p) => p.draft.id === post.id)).toBe(false);
    expect((await read(`/api/posts/${post.id}`)).status).toBe(200);
    const listSpy = vi.spyOn(D1PostRepository.prototype, "list");
    const response = await read(media.url);
    expect(response.status).toBe(200);
    // 返回的是落库的 WebP（不保留原 PNG），与 R2 中的对象逐字节一致。
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      env.BUCKET.objects.get(`media/${media.id}.webp`),
    );
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(listSpy).not.toHaveBeenCalled();
  });
  it("16条私密候选之后仍能找到公开复用，删除后不得向匿名泄漏", async () => {
    const source = await draft("source-binding-without-reference");
    await service.publish(source.id, { version: 1 });
    const media = await saveMedia(env, png(), {
      name: "reused.png",
      mime: "image/png",
      postId: source.id,
    });
    const passwordHash = await hashPassword("private-password");
    for (let i = 0; i < 17; i++) {
      const post = await draft(
        `a-private-${String(i).padStart(2, "0")}`,
        media.url,
        passwordHash,
      );
      await service.publish(post.id, { version: 1, visibility: "password" });
    }
    expect((await read(media.url)).status).toBe(404);
    const visible = await draft("z-public-reuse", media.url);
    await service.publish(visible.id, { version: 1 });
    const candidateSpy = vi.spyOn(
      D1PostRepository.prototype,
      "publishedMediaCandidates",
    );
    expect((await read(media.url)).status).toBe(200);
    expect(candidateSpy).toHaveBeenCalledTimes(2);
    expect(candidateSpy.mock.calls[1][1]).toBe("a-private-15");
    candidateSpy.mockRestore();
    await service.remove(visible.id, 2);
    expect((await read(media.url)).status).toBe(404);
    const unlocked = await handleAPI({
      request: new Request("https://site.test/api/posts/a-private-00/unlock", {
        method: "POST",
        headers: {
          Origin: "https://site.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "private-password" }),
      }),
      locals: { env },
    });
    expect(unlocked.status).toBe(200);
    expect(
      (await read(media.url, unlocked.headers.get("set-cookie")!.split(";")[0]))
        .status,
    ).toBe(200);
  });
  it("未绑定媒体不自动公开，只有精确引用而非相似URL才能授权", async () => {
    const media = await saveMedia(env, png(), {
      name: "unused.png",
      mime: "image/png",
    });
    expect(media.postId).toBeNull();
    expect((await read(media.url)).status).toBe(404);
    const prefix = await draft("similar-url", `${media.url}-other`);
    await service.publish(prefix.id, { version: 1 });
    const external = await draft(
      "external-url",
      `https://example.test${media.url}`,
    );
    await service.publish(external.id, { version: 1 });
    expect((await read(media.url)).status).toBe(404);
  });
});
