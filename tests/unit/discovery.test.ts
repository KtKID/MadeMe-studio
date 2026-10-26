import { describe, expect, it } from "vitest";
import { buildRss, buildSitemap } from "../../src/server/discovery/feed";
import type { Post } from "../../src/shared/contracts";
const post: Post = {
  id: "1",
  slug: "hello",
  title: "标题 <script>",
  excerpt: "A & B",
  blocks: [],
  category: "",
  tags: [],
  coverImage: "",
  visibility: "public",
  pinned: false,
  version: 1,
  publishedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  deletedAt: null,
};
describe("公开内容发现", () => {
  it("RSS转义文本且只包含公开已发布文章", () => {
    const rss = buildRss("https://example.com", "站点", [
      post,
      { ...post, id: "2", slug: "secret", visibility: "password" },
      { ...post, id: "3", slug: "draft", publishedAt: null },
    ]);
    expect(rss).toContain("&lt;script&gt;");
    expect(rss).toContain("A &amp; B");
    expect(rss).not.toContain("/p/secret");
    expect(rss).not.toContain("/p/draft");
  });
  it("sitemap排除链接访问和回收站", () => {
    const xml = buildSitemap("https://example.com", [
      post,
      { ...post, slug: "hidden", visibility: "unlisted" },
      { ...post, slug: "deleted", deletedAt: "2026-01-03T00:00:00Z" },
    ]);
    expect(xml).toContain("/p/hello");
    expect(xml).not.toContain("/p/hidden");
    expect(xml).not.toContain("/p/deleted");
  });
});
