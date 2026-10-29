import type { ArticleType } from "./contracts";
import type { Post } from "../../shared/contracts";
type TypedPost = Pick<Post, "category" | "categoryId">;

/**
 * 稳定 ID 优先；仅无 ID 的旧文章按当前名/历史名精确归属。
 * 已删除的显式 ID 不回退到名字，以免被后来创建的同名类型劫持。
 */
export function resolveArticleType(
  post: TypedPost,
  types: ArticleType[],
): ArticleType | undefined {
  if (post.categoryId) return types.find((type) => type.id === post.categoryId);
  return types.find(
    (type) =>
      type.name === post.category || type.legacyNames?.includes(post.category),
  );
}

export function matchesArticleType(
  post: TypedPost,
  id: string,
  types: ArticleType[],
): boolean {
  return !id || resolveArticleType(post, types)?.id === id;
}

/** 更名不批量重写文章，阅读/筛选统一显示新名称；未归属旧数据保留原文字。 */
export function articleTypeName(post: TypedPost, types: ArticleType[]): string {
  return resolveArticleType(post, types)?.name || post.category;
}
