import type { Post } from "../../shared/contracts";
import {
  DEFAULT_COVER_SETTINGS,
  normalizeCoverSettings,
} from "../../modules/cover/contracts";
/** 仅编辑器保存的字段；封面/裁切、分类名称/id各自作为不可拆的整体。正文也只作整体比较。 */
export const mergeGroups = {
  title: ["title"],
  blocks: ["blocks"],
  excerpt: ["excerpt"],
  category: ["category", "categoryId"],
  tags: ["tags"],
  coverImage: ["coverImage", "coverSettings"],
  slug: ["slug"],
} as const;
export type ConflictField = keyof typeof mergeGroups;
export const conflictLabels: Record<ConflictField, string> = {
  title: "标题",
  blocks: "正文（整篇）",
  excerpt: "摘要",
  category: "分类",
  tags: "标签",
  coverImage: "封面及裁切",
  slug: "文章链接",
};
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameValue(v, b[i]))
    );
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((k) => x[k] !== undefined),
    other = Object.keys(y).filter((k) => y[k] !== undefined);
  return (
    keys.length === other.length && keys.every((k) => sameValue(x[k], y[k]))
  );
}
export function normalizedPost(p: Post): Post {
  return {
    ...p,
    categoryId: p.categoryId ?? null,
    coverSettings: p.coverImage
      ? normalizeCoverSettings(p.coverSettings)
      : { ...DEFAULT_COVER_SETTINGS },
  };
}
function values(p: Post, group: ConflictField) {
  return mergeGroups[group].map((k) => p[k]);
}
function copyGroup(target: Post, source: Post, group: ConflictField) {
  for (const key of mergeGroups[group])
    Object.assign(target, { [key]: source[key] });
}
export function mergePost(base: Post, local: Post, remote: Post) {
  const b = normalizedPost(base),
    l = normalizedPost(local),
    r = normalizedPost(remote);
  const post = structuredClone(r),
    conflicts: ConflictField[] = [];
  for (const group of Object.keys(mergeGroups) as ConflictField[]) {
    const localChanged = !sameValue(values(b, group), values(l, group));
    const remoteChanged = !sameValue(values(b, group), values(r, group));
    if (
      localChanged &&
      remoteChanged &&
      !sameValue(values(l, group), values(r, group))
    )
      conflicts.push(group);
    else if (localChanged) copyGroup(post, l, group);
  }
  return { post, conflicts };
}
export type PostMerge = ReturnType<typeof mergePost>;
export function chooseLocalConflicts(merge: PostMerge, local: Post): Post {
  const post = structuredClone(merge.post),
    l = normalizedPost(local);
  for (const group of merge.conflicts) copyGroup(post, l, group);
  return post;
}
/** 不向PATCH泄露发布/删除等非编辑器字段；协议类型仍来自共享Zod。 */
export function editablePatch(p: Post) {
  return {
    title: p.title,
    blocks: p.blocks,
    excerpt: p.excerpt,
    category: p.category,
    categoryId: p.categoryId,
    tags: p.tags,
    coverImage: p.coverImage,
    coverSettings: p.coverSettings,
    slug: p.slug,
  };
}
