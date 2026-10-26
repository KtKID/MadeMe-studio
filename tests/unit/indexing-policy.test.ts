import { describe, expect, it } from "vitest";
import { canIndexPost } from "../../src/server/response-policy";
describe("文章索引边界", () => {
  it("仅公开已发布文章允许索引", () => {
    expect(
      canIndexPost({ visibility: "public", publishedAt: "2026-01-01" }),
    ).toBe(true);
    for (const visibility of ["draft", "password", "unlisted"] as const)
      expect(canIndexPost({ visibility, publishedAt: "2026-01-01" })).toBe(
        false,
      );
    expect(canIndexPost({ visibility: "public", publishedAt: null })).toBe(
      false,
    );
    expect(canIndexPost(null)).toBe(false);
  });
});
