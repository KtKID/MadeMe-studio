import { logger, logCaught } from "../../modules/log/server";
import {
  IMAGE_RECIPE,
  MEDIA_DELETE_COVER_RETRIES,
  MEDIA_DELETE_LIST_PAGE,
} from "../../modules/config";
import type {
  DeleteMediaResult,
  MediaReference,
  Post,
} from "../../shared/contracts";
import type { D1Database, R2Bucket, RuntimeEnv } from "../runtime";
import { AppError, notFound } from "../errors";
import { D1PostRepository } from "../content/repository";
import type { MediaRow } from "./service";

const fileUrl = (id: string) => `/api/files/${id}`;
const bodyUses = (post: Post | null, url: string) =>
  !!post && JSON.stringify(post.blocks ?? []).includes(`"${url}"`);

/**
 * 找出引用该媒体的所有文章（草稿文档或已发布快照里任意位置出现 /api/files/<id>），含回收站中的文章。
 * 逐行再用 coverImage / blocks 精确判定封面与正文，json_tree 只负责缩小范围。
 */
export async function mediaReferences(
  db: D1Database,
  id: string,
): Promise<MediaReference[]> {
  const url = fileUrl(id);
  const result = await db
    .prepare(
      "SELECT id,document_json,published_json,deleted_at FROM posts WHERE EXISTS (SELECT 1 FROM json_tree(posts.document_json) WHERE json_tree.type='text' AND json_tree.atom=?) OR (published_json IS NOT NULL AND EXISTS (SELECT 1 FROM json_tree(posts.published_json) WHERE json_tree.type='text' AND json_tree.atom=?)) ORDER BY id ASC",
    )
    .bind(url, url)
    .all<{
      id: string;
      document_json: string;
      published_json: string | null;
      deleted_at: string | null;
    }>();
  return result.results.map((row) => {
    const draft = JSON.parse(row.document_json) as Post;
    const published = row.published_json
      ? (JSON.parse(row.published_json) as Post)
      : null;
    return {
      postId: row.id,
      title: draft.title || published?.title || "未命名文章",
      cover: draft.coverImage === url || published?.coverImage === url,
      body: bodyUses(draft, url) || bodyUses(published, url),
      published:
        !!published &&
        (published.coverImage === url || bodyUses(published, url)),
      trashed: !!row.deleted_at,
    };
  });
}

/**
 * 只清封面，正文不动：草稿 coverImage 置空（版本 +1，修订原因 save），
 * 已发布快照的封面若也是该图一并置空——文件删除后线上封面本来就会变成坏图，置空让页面干净地不显示封面。
 * 版本冲突（文章正被并发保存）时重读重试，仍失败则抛 409，此时尚未删除任何媒体数据。
 */
async function clearCover(db: D1Database, postId: string, url: string) {
  const repository = new D1PostRepository(db);
  for (let attempt = 0; attempt < MEDIA_DELETE_COVER_RETRIES; attempt++) {
    const row = await repository.get(postId);
    if (!row) return null;
    const draftUses = row.draft.coverImage === url;
    const publishedUses = row.published?.coverImage === url;
    if (!draftUses && !publishedUses) return null;
    const expected = row.draft.version;
    row.draft = {
      ...row.draft,
      ...(draftUses ? { coverImage: "" } : {}),
      version: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    if (publishedUses && row.published)
      row.published = { ...row.published, coverImage: "" };
    if (await repository.save(row, expected, "save")) {
      logger.info("media.delete_cover_cleared", {
        postId,
        draft: draftUses,
        published: publishedUses,
      });
      return { postId, version: expected + 1 };
    }
  }
  throw new AppError(
    409,
    "VERSION_CONFLICT",
    "引用这张图片的文章正在被保存，请稍后再删除。",
  );
}

/** 删除 image-derivatives/v1/<id>/ 下所有对象（含 s1/ 子目录与 manifest）。 */
async function deleteDerivatives(bucket: R2Bucket, id: string) {
  const prefix = `image-derivatives/${IMAGE_RECIPE}/${id}/`;
  let cursor: string | undefined;
  let removed = 0;
  do {
    const page = await bucket.list({
      prefix,
      limit: MEDIA_DELETE_LIST_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    for (const object of page.objects) {
      await bucket.delete(object.key);
      removed++;
    }
    if (page.truncated && !page.cursor)
      throw new Error("R2 list 返回 truncated 但没有 cursor");
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

/**
 * DELETE /api/media/:id：被文章引用且未 force → 409 MEDIA_IN_USE（details.posts 列出文章）。
 * 顺序：清封面 → 删 D1 行 → 删 object_key 对象 → 删衍生目录。行删除后对象删除失败只记录孤儿日志，
 * 不回报失败，保证媒体不会“半删”地仍出现在媒体库里。
 */
export async function deleteMedia(
  env: RuntimeEnv,
  id: string,
  force: boolean,
): Promise<DeleteMediaResult> {
  if (!env.DB || !env.BUCKET) throw notFound();
  const row = await env.DB.prepare("SELECT * FROM media WHERE id=?")
    .bind(id)
    .first<MediaRow>();
  if (!row) throw notFound();
  const references = await mediaReferences(env.DB, id);
  if (references.length && !force)
    throw new AppError(
      409,
      "MEDIA_IN_USE",
      `这份素材正被 ${references.length} 篇文章使用。`,
      { posts: references },
    );
  const url = fileUrl(id);
  const clearedCovers: DeleteMediaResult["clearedCovers"] = [];
  for (const reference of references.filter((r) => r.cover)) {
    const cleared = await clearCover(env.DB, reference.postId, url);
    if (cleared) clearedCovers.push(cleared);
  }
  const deleted = await env.DB.prepare("DELETE FROM media WHERE id=?")
    .bind(id)
    .run();
  if (!deleted.meta?.changes) throw notFound();
  try {
    await env.BUCKET.delete(row.object_key);
  } catch (error) {
    logCaught("media.delete_orphan_object", error, {
      mediaId: id,
      key: row.object_key,
    });
  }
  let derivatives = 0;
  try {
    derivatives = await deleteDerivatives(env.BUCKET, id);
  } catch (error) {
    logCaught("media.delete_orphan_derivatives", error, { mediaId: id });
  }
  logger.info("media.deleted", {
    mediaId: id,
    force,
    references: references.length,
    clearedCovers: clearedCovers.length,
    derivatives,
  });
  return { deleted: true, clearedCovers };
}
