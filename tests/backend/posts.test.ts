import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { PostService, publicPosts } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
import { fixtureEnv, blocks } from "./support";
import {
  validateContent,
  isSafeEmbed,
} from "../../src/server/content/validation";
import { markdownToBlocks } from "../../src/server/content/markdown";
import { validateMedia } from "../../src/server/media/service";
let env: ReturnType<typeof fixtureEnv>;
let posts: PostService;
beforeEach(() => {
  env = fixtureEnv();
  posts = new PostService(new D1PostRepository(env.DB));
});
afterEach(() => env.DB.close());
describe("文章事务与可见性集成测试", () => {
  it("真实迁移能创建草稿、发布快照，后续保存不污染已发布内容", async () => {
    const draft = await posts.create({ title: "First", blocks });
    expect(draft.version).toBe(1);
    expect(publicPosts(await posts.repository.list())).toHaveLength(0);
    const published = await posts.publish(draft.id, {
      version: 1,
      visibility: "public",
    });
    expect(published.version).toBe(2);
    await posts.update(draft.id, { version: 2, title: "Unpublished edit" });
    const row = await posts.mustGet(draft.id);
    expect(row.draft.title).toBe("Unpublished edit");
    expect(row.published?.title).toBe("First");
    expect(publicPosts([row])[0].title).toBe("First");
    expect(await posts.repository.revisions(draft.id)).toHaveLength(3);
  });
  it("拒绝过期版本并确保失败不留下虚假修订", async () => {
    const draft = await posts.create({ title: "First", blocks });
    await posts.update(draft.id, { version: 1, title: "Winner" });
    await expect(
      posts.update(draft.id, { version: 1, title: "Loser" }),
    ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect((await posts.mustGet(draft.id)).draft.title).toBe("Winner");
    expect(await posts.repository.revisions(draft.id)).toHaveLength(2);
  });
  it("仓库 CAS 返回 false，失败的更新不插入修订", async () => {
    const draft = await posts.create({ title: "First", blocks });
    const stale = await posts.mustGet(draft.id);
    await posts.update(draft.id, { version: 1, title: "Winner" });
    stale.draft = { ...stale.draft, title: "Loser", version: 2 };
    expect(await posts.repository.save(stale, 1, "save")).toBe(false);
    expect(await posts.repository.revisions(draft.id)).toHaveLength(2);
  });
  it("密码和链接访问文章不进入公开列表，草稿保存不改变已发布密码", async () => {
    const draft = await posts.create({
      title: "Private",
      blocks,
      password: "first-password",
    });
    await posts.publish(draft.id, { version: 1, visibility: "password" });
    const before = await posts.mustGet(draft.id);
    await posts.update(draft.id, { version: 2, password: "second-password" });
    const after = await posts.mustGet(draft.id);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.publishedPasswordHash).toBe(before.publishedPasswordHash);
    expect(publicPosts([after])).toEqual([]);
    await posts.publish(draft.id, { version: 3, visibility: "unlisted" });
    expect(publicPosts(await posts.repository.list())).toEqual([]);
  });
  it("软删除立即隐藏快照，恢复、历史恢复和撤回遵循版本约束", async () => {
    const draft = await posts.create({ title: "First", blocks });
    await posts.publish(draft.id, { version: 1 });
    await posts.remove(draft.id, 2);
    expect(publicPosts(await posts.repository.list())).toEqual([]);
    await posts.restore(draft.id, 3);
    expect(publicPosts(await posts.repository.list())).toHaveLength(1);
    await posts.update(draft.id, { version: 4, title: "Changed" });
    const restored = await posts.restoreRevision(draft.id, 1, 5);
    expect(restored.title).toBe("First");
    expect(restored.version).toBe(6);
    await posts.unpublish(draft.id, 6);
    expect(publicPosts(await posts.repository.list())).toEqual([]);
  });
  it("冲突 slug 不损坏已有记录，密码文章必须先配置密码", async () => {
    const draft = await posts.create({ title: "First", slug: "same", blocks });
    await expect(
      posts.create({ title: "Second", slug: "same", blocks }),
    ).rejects.toMatchObject({ code: "SLUG_CONFLICT" });
    await expect(
      posts.publish(draft.id, { version: 1, visibility: "password" }),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
    expect((await posts.repository.list()).length).toBe(1);
  });
});
describe("已发布 URL 保留回归", () => {
  it("草稿改名后旧发布 slug 仍被保留，其他文章不能抢占", async () => {
    const original = await posts.create({
      title: "Original",
      slug: "stable-url",
      blocks,
    });
    await posts.publish(original.id, { version: 1 });
    await posts.update(original.id, { version: 2, slug: "draft-url" });
    await expect(
      posts.create({ title: "Collision", slug: "stable-url", blocks }),
    ).rejects.toMatchObject({ status: 409, code: "SLUG_CONFLICT" });
    const other = await posts.create({
      title: "Other",
      slug: "other-url",
      blocks,
    });
    await expect(
      posts.update(other.id, { version: 1, slug: "stable-url" }),
    ).rejects.toMatchObject({ status: 409, code: "SLUG_CONFLICT" });
    expect((await posts.mustGet(other.id)).draft.version).toBe(1);
    expect((await posts.repository.bySlug("stable-url"))?.published?.id).toBe(
      original.id,
    );
  });
});

describe("输入安全单元测试", () => {
  it("拒绝脚本链接与不受信的嵌入，保留字面文本", () => {
    expect(() =>
      validateContent([
        {
          type: "paragraph",
          content: [{ type: "link", href: "javascript:alert(1)", content: [] }],
        },
      ]),
    ).toThrow();
    expect(() =>
      validateContent([
        { type: "embed", props: { url: "https://evil.test/watch" } },
      ]),
    ).toThrow();
    expect(isSafeEmbed("https://youtube.com/watch?v=test")).toBe(true);
    expect(isSafeEmbed("https://youtube.com.evil.test/")).toBe(false);
    expect(() =>
      validateContent([
        {
          type: "paragraph",
          content: [{ type: "text", text: "javascript is a language" }],
        },
      ]),
    ).not.toThrow();
  });
  it("拒绝 HTML、SVG 及伪造图片 MIME", () => {
    expect(() =>
      validateMedia(new TextEncoder().encode("<svg/>"), "image/svg+xml"),
    ).toThrow();
    expect(() =>
      validateMedia(
        new TextEncoder().encode("<script>bad()</script>"),
        "image/png",
      ),
    ).toThrow();
    expect(() =>
      validateMedia(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        "image/png",
      ),
    ).not.toThrow();
  });
  it("Markdown 导入保留代码与格式，将原始 HTML 视为文字", () => {
    const parsed = markdownToBlocks(
      "# Hello\n\n**Bold** and [safe](https://example.test)\n\n```ts\nconst x = 1\n```\n\n<script>alert(1)</script>",
    );
    expect(parsed.map((p) => p.type)).toEqual([
      "heading",
      "paragraph",
      "codeBlock",
      "paragraph",
    ]);
    expect(JSON.stringify(parsed)).toContain("<script>");
    expect(() => validateContent(parsed)).not.toThrow();
  });
});
