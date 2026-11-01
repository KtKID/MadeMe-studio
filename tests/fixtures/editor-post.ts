import type { Post } from "../../src/shared/contracts";
export const defaultPost = (): Post => ({
  id: "fixture",
  version: 1,
  title: "原始标题",
  slug: "fixture",
  excerpt: "",
  blocks: [{ type: "paragraph", content: "原始正文" }],
  category: "",
  tags: [],
  coverImage: "/api/files/cover",
  visibility: "draft",
  pinned: false,
  publishedAt: null,
  updatedAt: "2026-10-27T00:00:00Z",
  deletedAt: null,
});
