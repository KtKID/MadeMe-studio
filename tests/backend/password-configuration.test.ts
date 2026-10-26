import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAPI } from "../../src/server/api";
import { loadPageData } from "../../src/server/page-data";
import { PostService } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
import { fixtureEnv, blocks } from "./support";
let env: ReturnType<typeof fixtureEnv>;
let service: PostService;
beforeEach(() => {
  env = fixtureEnv();
  service = new PostService(new D1PostRepository(env.DB));
});
afterEach(() => env.DB.close());
async function publish(id: string, body: unknown) {
  return handleAPI({
    request: new Request(`https://site.test/api/posts/${id}/publish`, {
      method: "POST",
      headers: {
        Origin: "https://site.test",
        "Content-Type": "application/json",
        "oai-authenticated-user-id": "test-owner",
      },
      body: JSON.stringify(body),
    }),
    locals: { env },
  });
}
describe("密码发布配置边界", () => {
  it.each([undefined, "short-secret", "x".repeat(31)])(
    "SESSION_SECRET缺失或过短时发布前拒绝：%s",
    async (secret) => {
      env.SESSION_SECRET = secret;
      const post = await service.create({ title: "Private draft", blocks });
      const response = await publish(post.id, {
        version: 1,
        visibility: "password",
        password: "article-password",
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "SESSION_SETUP_REQUIRED" },
      });
      const row = await service.mustGet(post.id);
      expect(row.draft.version).toBe(1);
      expect(row.published).toBeNull();
      expect(row.passwordHash).toBeNull();
      expect(await service.repository.revisions(post.id)).toHaveLength(1);
    },
  );
  it("最终可见性从草稿继承为password时也先拒绝，并保留既有发布快照", async () => {
    const post = await service.create({
      title: "Original published title",
      blocks,
    });
    await service.publish(post.id, { version: 1, visibility: "public" });
    await service.update(post.id, {
      version: 2,
      title: "Unpublished changes",
      visibility: "password",
    });
    const before = await service.mustGet(post.id);
    env.SESSION_SECRET = undefined;
    const response = await publish(post.id, {
      version: 3,
      password: "new-article-password",
    });
    expect(response.status).toBe(503);
    expect(await service.mustGet(post.id)).toEqual(before);
    expect(await service.repository.revisions(post.id)).toHaveLength(3);
  });
  it("配置有效时允许密码发布，公开和链接发布不依赖会话密钥", async () => {
    env.SESSION_SECRET = "test-only-session-value-32-bytes!!";
    const privatePost = await service.create({
      title: "Password draft",
      blocks,
    });
    expect(
      (
        await publish(privatePost.id, {
          version: 1,
          visibility: "password",
          password: "article-password",
        })
      ).status,
    ).toBe(200);
    expect((await service.mustGet(privatePost.id)).published?.visibility).toBe(
      "password",
    );
    env.SESSION_SECRET = undefined;
    for (const visibility of ["public", "unlisted"]) {
      const post = await service.create({
        title: `${visibility} draft`,
        blocks,
      });
      expect((await publish(post.id, { version: 1, visibility })).status).toBe(
        200,
      );
    }
  });
  it("只向作者报告密码发布是否已配置，绝不回传密钥", async () => {
    const context = {
      request: new Request("https://site.test", {
        headers: { "oai-authenticated-user-id": "test-owner" },
      }),
      locals: { env },
    };
    env.SESSION_SECRET = undefined;
    expect((await loadPageData(context)).capabilities).toMatchObject({
      passwordConfigured: false,
    });
    env.SESSION_SECRET = "test-only-session-value-32-bytes!!";
    const data = await loadPageData(context);
    expect(data.capabilities).toMatchObject({ passwordConfigured: true });
    expect(JSON.stringify(data)).not.toContain(env.SESSION_SECRET);
    expect(
      (
        await loadPageData({
          request: new Request("https://site.test"),
          locals: { env },
        })
      ).capabilities,
    ).toMatchObject({ passwordConfigured: false });
  });
});
