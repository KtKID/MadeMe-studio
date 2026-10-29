import { expect, it } from "vitest";
import {
  articleTypeName,
  matchesArticleType,
} from "../src/modules/article-types/matching";
const types = [
  { id: "ai", name: "人工智能", legacyNames: ["AI", "人工智能旧名"] },
  { id: "reflection", name: "感悟" },
];
it("类型重命名后旧无ID文章通过历史名称归属并显示新名称", () => {
  expect(matchesArticleType({ category: "AI" }, "ai", types)).toBe(true);
  expect(articleTypeName({ category: "AI" }, types)).toBe("人工智能");
  expect(matchesArticleType({ category: "人工智能旧名" }, "ai", types)).toBe(
    true,
  );
  expect(matchesArticleType({ category: "ai" }, "ai", types)).toBe(false);
});
it("显式ID始终优先，旧名称不会劫持其他或已删除的ID", () => {
  expect(
    matchesArticleType(
      { category: "AI", categoryId: "reflection" },
      "ai",
      types,
    ),
  ).toBe(false);
  expect(
    articleTypeName({ category: "AI", categoryId: "reflection" }, types),
  ).toBe("感悟");
  expect(
    matchesArticleType({ category: "AI", categoryId: "deleted" }, "ai", types),
  ).toBe(false);
  expect(
    articleTypeName({ category: "AI", categoryId: "deleted" }, types),
  ).toBe("AI");
});
