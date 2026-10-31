import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LEGACY_POST_KEYS,
  POST_SCHEMA_ACCEPT,
  POST_SCHEMA_VERSION,
  legacyPost,
  postMutationResponseSchema,
  postSchema,
  requestedPostSchema,
} from "../src/shared/contracts";

// 与已发出的集成 0.1.0 包（如 /tmp/pk/mademe-publisher/main.js）完全相同的读取协议：
// 完整 Post 与回执都用 .strict()，任何新增字段都会让解析失败。
const legacyStrictClientSchema = z
  .object({
    post: z.union([
      postSchema
        .pick(
          Object.fromEntries(LEGACY_POST_KEYS.map((k) => [k, true])) as {
            [K in (typeof LEGACY_POST_KEYS)[number]]: true;
          },
        )
        .strict(),
      postSchema.pick({ id: true, version: true }).strict(),
    ]),
  })
  .strict();

const post = {
  id: "post-1",
  version: 3,
  title: "T",
  slug: "t",
  excerpt: "",
  blocks: [],
  category: "",
  tags: [],
  coverImage: "/api/files/abc",
  visibility: "public" as const,
  pinned: false,
  publishedAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  deletedAt: null,
  hasUnpublishedChanges: false,
  publishedVisibility: "public" as const,
  coverSettings: {
    aspect: "1:1" as const,
    fit: "cover" as const,
    focusX: 50,
    focusY: 0,
    zoom: 1,
  },
};

describe("集成客户端读取兼容", () => {
  it("根因：旧版 strict 客户端解析含新字段的响应失败（unrecognized_keys）", () => {
    const parsed = legacyStrictClientSchema.safeParse({ post });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("coverSettings");
  });

  it("旧格式（legacyPost）可被旧版 strict 客户端解析，且不含后加字段", () => {
    const legacy = legacyPost(post);
    expect(Object.keys(legacy).sort()).toEqual([...LEGACY_POST_KEYS].sort());
    expect(legacyStrictClientSchema.safeParse({ post: legacy }).success).toBe(
      true,
    );
  });

  it("新读取协议容忍新增字段：顶层、文章内与封面设置内的未知字段都被剥离", () => {
    const future = {
      post: {
        ...post,
        futureField: { anything: true },
        coverSettings: { ...post.coverSettings, fill: "#fff" },
      },
      meta: { schema: 3 },
    };
    const parsed = postMutationResponseSchema.safeParse(future);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.post).not.toHaveProperty("futureField");
    expect(postMutationResponseSchema.safeParse({ post }).success).toBe(true);
    expect(
      postMutationResponseSchema.safeParse({ post: legacyPost(post) }).success,
    ).toBe(true);
  });

  it("新读取协议仍拒绝畸形或混入正文的最小回执", () => {
    for (const bad of [
      { id: "post-1" },
      { id: "post-1", version: 0 },
      { id: "post-1", version: 1, blocks: [{ content: "Private" }] },
      { id: "post-1", version: 1, visibility: "public" },
    ])
      expect(postMutationResponseSchema.safeParse({ post: bad }).success).toBe(
        false,
      );
    expect(
      postMutationResponseSchema.safeParse({ post: { id: "p", version: 1 } })
        .success,
    ).toBe(true);
  });

  it("客户端通过 Accept 媒体类型参数声明读取版本（CORS 安全头，不需要预检放行）", () => {
    expect(POST_SCHEMA_ACCEPT).toBe(
      `application/json; mademe-post-schema=${POST_SCHEMA_VERSION}`,
    );
    expect(requestedPostSchema(null)).toBe(1);
    expect(requestedPostSchema("application/json")).toBe(1);
    expect(requestedPostSchema(POST_SCHEMA_ACCEPT)).toBe(POST_SCHEMA_VERSION);
    expect(
      requestedPostSchema("text/html, application/json;mademe-post-schema=7"),
    ).toBe(7);
    expect(requestedPostSchema("application/json; mademe-post-schema=x")).toBe(
      1,
    );
  });
});
