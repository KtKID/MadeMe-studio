// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import PublicFeed from "../../src/components/content/PublicFeed";
import { postSchema, type Post } from "../../src/shared/contracts";

const post = (id: number, patch: Partial<Post> = {}) =>
  postSchema.parse({
    id: String(id),
    title: `文章 ${id}`,
    slug: `post-${id}`,
    excerpt: "仅重点文章显示的摘要",
    category: "随笔",
    tags: ["搜索标签"],
    blocks: [],
    coverImage: "",
    visibility: "public",
    pinned: false,
    version: 1,
    publishedAt: `2026-10-${String(id).padStart(2, "0")}T00:00:00Z`,
    updatedAt: "2026-10-30T00:00:00Z",
    deletedAt: null,
    ...patch,
  });
afterEach(cleanup);

it.each(["ink", "garden", "mono"] as const)(
  "%s 仍保留作者选择的原有布局和文章",
  (theme) => {
    const { container } = render(
      <PublicFeed
        posts={[post(1), post(2), post(3), post(4)]}
        theme={theme}
        authenticated={false}
      />,
    );
    expect(container.querySelector(".home-featured")).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(
      container.querySelector(".public-feed")?.getAttribute("data-layout"),
    ).toBe(theme);
  },
);

it("刊物优先选置顶再按原发布时间取三篇，普通区不重复且只有封面与标题", () => {
  const posts = Array.from({ length: 8 }, (_, i) => post(i + 1));
  posts[0].pinned = true;
  const original = posts.map((p) => p.id);
  const { container } = render(
    <PublicFeed posts={posts} authenticated={false} />,
  );
  const featured = screen.getByRole("region", { name: "重点文章" });
  expect(
    within(featured)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent),
  ).toEqual(["文章 1", "文章 8", "文章 7"]);
  expect(featured.querySelectorAll(".home-post--lead")).toHaveLength(1);
  expect(featured.querySelectorAll(".home-post--secondary")).toHaveLength(2);
  const ordinary = screen.getByRole("region", { name: "更多文章" });
  expect(
    within(ordinary)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent),
  ).toEqual(["文章 6", "文章 5", "文章 4", "文章 3", "文章 2"]);
  expect(
    ordinary.querySelectorAll(".article-meta, .article-card-bottom"),
  ).toHaveLength(0);
  expect(within(ordinary).queryByText("仅重点文章显示的摘要")).toBeNull();
  expect(container.querySelectorAll("article")).toHaveLength(8);
  expect(posts.map((p) => p.id)).toEqual(original);
});

it.each([1, 2, 3])(
  "只有 %i 篇时重点区自然降级，不生成空卡或空普通区",
  (count) => {
    const { container } = render(
      <PublicFeed
        posts={Array.from({ length: count }, (_, i) => post(i + 1))}
        authenticated={false}
      />,
    );
    expect(container.querySelectorAll("article")).toHaveLength(count);
    expect(screen.queryByRole("region", { name: "更多文章" })).toBeNull();
    expect(container.querySelectorAll(".abstract-cover")).toHaveLength(count);
  },
);

it("搜索仍覆盖标签和原普通区文章，结果重新分组；无匹配和空库保持真实空态", () => {
  render(
    <PublicFeed
      posts={Array.from({ length: 8 }, (_, i) => post(i + 1))}
      authenticated={false}
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "文章 2" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(
    within(screen.getByRole("region", { name: "重点文章" })).getByRole(
      "heading",
      { name: "文章 2" },
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "搜索标签" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(8);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "不存在" },
  });
  expect(screen.getByText("没有找到相关文字")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "重点文章" })).toBeNull();
  cleanup();
  render(<PublicFeed posts={[]} authenticated />);
  expect(
    screen.getByRole("link", { name: "写下第一篇文章" }).getAttribute("href"),
  ).toBe("/studio/new");
});
