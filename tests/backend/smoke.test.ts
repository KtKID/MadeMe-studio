import { describe, it, expect } from "vitest";
import { loadPageData, loadPostPage } from "../../src/server/page-data";
import { handleAPI } from "../../src/server/api";
import { fixtureEnv, blocks } from "./support";
import { PostService } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
describe("服务端渲染冒烟测试", () => {
  it("没有云绑定时仍返回可读空站与真实配置状态", async () => {
    const context = { request: new Request("https://site.test"), locals: {} };
    const data = await loadPageData(context);
    expect(data.settings.siteTitle).toBe("MadeMe");
    expect(data.posts).toEqual([]);
    expect(data.capabilities.storageConfigured).toBe(false);
    expect(data.capabilities.authenticated).toBe(false);
    const response = await handleAPI({
      request: new Request("https://site.test/api/posts", {
        method: "POST",
        headers: {
          origin: "https://site.test",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      locals: {},
    });
    expect(response.status).toBe(503);
  });
  it("作者阅读页优先显示发布快照，未发布草稿只对作者可见", async () => {
    const env = fixtureEnv();
    try {
      const service = new PostService(new D1PostRepository(env.DB));
      const post = await service.create({ title: "Original", blocks });
      const owner = {
        request: new Request("https://site.test", {
          headers: { "oai-authenticated-user-id": "test-owner" },
        }),
        locals: { env },
      };
      const visitor = {
        request: new Request("https://site.test"),
        locals: { env },
      };
      expect((await loadPostPage(owner, post.slug)).post?.title).toBe(
        "Original",
      );
      expect((await loadPostPage(visitor, post.slug)).post).toBeNull();
      await service.publish(post.id, { version: 1 });
      await service.update(post.id, { version: 2, title: "Draft edit" });
      expect((await loadPostPage(owner, post.slug)).post?.title).toBe(
        "Original",
      );
      expect((await loadPostPage(visitor, post.slug)).post?.title).toBe(
        "Original",
      );
    } finally {
      env.DB.close();
    }
  });
});
