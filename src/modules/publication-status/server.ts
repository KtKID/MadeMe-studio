import type { Post } from "../../shared/contracts";
import type { StoredPost } from "../../server/content/repository";
import {
  DEFAULT_ARTICLE_TYPES,
  type ArticleType,
} from "../article-types/contracts";
import { resolveArticleType } from "../article-types/matching";
import type { PublicationStatus } from "./contracts";

/** 对象键排序不改变数组顺序；只消除编辑器已知的无显示差异默认值。 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stable(v)]),
  );
}
function normalizedProperties(
  value: unknown,
  kind: "props" | "styles",
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          !(
            (["textColor", "backgroundColor"].includes(key) &&
              item === "default") ||
            (kind === "props" && key === "textAlignment" && item === "left") ||
            (kind === "styles" &&
              ["bold", "italic", "underline", "strike", "code"].includes(key) &&
              item === false)
          ),
      )
      .map(([key, item]) => [key, inlineContent(item)]),
  );
}
function inlineContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inlineContent);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const next =
      key === "styles"
        ? normalizedProperties(item, "styles")
        : inlineContent(item);
    if (
      key === "styles" &&
      next &&
      typeof next === "object" &&
      Object.keys(next).length === 0
    )
      continue;
    result[key] = next;
  }
  return result;
}
/** 只遍历真实块树的 id；props/媒体/链接内部的 id 是内容，不可删除。 */
function blockContent(value: unknown): unknown {
  if (!Array.isArray(value)) return inlineContent(value);
  return value.map((block: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(block)) {
      if (key === "id") continue;
      if (key === "children") {
        if (Array.isArray(item) && item.length === 0) continue;
        result[key] = blockContent(item);
        continue;
      }
      const next =
        key === "props"
          ? normalizedProperties(item, "props")
          : inlineContent(item);
      if (
        key === "props" &&
        next &&
        typeof next === "object" &&
        Object.keys(next).length === 0
      )
        continue;
      result[key] = next;
    }
    return result;
  });
}
function publishedContent(post: Post, types: ArticleType[]) {
  const type = resolveArticleType(post, types);
  return stable({
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    blocks: blockContent(post.blocks),
    category: type
      ? { id: type.id }
      : post.categoryId
        ? { id: post.categoryId, name: post.category }
        : { name: post.category },
    tags: post.tags,
    coverImage: post.coverImage,
    visibility: post.visibility,
    pinned: post.pinned,
  });
}
export function publicationStatus(
  row: StoredPost,
  types: ArticleType[] = DEFAULT_ARTICLE_TYPES,
): PublicationStatus {
  const published = row.published;
  return {
    hasUnpublishedChanges:
      !!published &&
      JSON.stringify(publishedContent(row.draft, types)) !==
        JSON.stringify(publishedContent(published, types)),
    publishedVisibility:
      published && published.visibility !== "draft"
        ? published.visibility
        : null,
  };
}
/** 返回副本，绝不把状态写回草稿、发布快照或历史修订。 */
export function draftWithPublicationStatus(
  row: StoredPost,
  types: ArticleType[] = DEFAULT_ARTICLE_TYPES,
): Post {
  return { ...row.draft, ...publicationStatus(row, types) };
}
