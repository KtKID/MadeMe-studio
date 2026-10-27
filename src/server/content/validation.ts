import {
  findContentProblems,
  isAllowedLink,
  summarizeProblems,
} from "../../modules/content-check";
import { parseEmbed, reportEmbedRejection } from "../../modules/embed";
import { logger } from "../../modules/log/server";
import {
  blocksSchema,
  type EditorBlock,
  type Post,
} from "../../shared/contracts";
import { AppError } from "../errors";
export function validateContent(blocks: EditorBlock[]) {
  blocksSchema.parse(blocks);
  if (JSON.stringify(blocks).length > 1_000_000)
    throw new AppError(
      413,
      "CONTENT_TOO_LARGE",
      "Article content is too large.",
    );
  // 链接问题按块定位，返回“第 N 个视频块……”的中文原因与 details.problems，
  // 编辑器直接显示；日志只记录原因、块类型与序号，不记录链接本身。
  const problems = findContentProblems(blocks);
  if (problems.length) {
    const first = problems[0];
    if (first.embed) reportEmbedRejection("server_validation", first.embed);
    logger.info("content.rejected", {
      code: first.code,
      reason: first.reason,
      blockType: first.blockType,
      ordinal: first.ordinal,
      field: first.field,
      count: problems.length,
    });
    throw new AppError(422, first.code, summarizeProblems(problems), {
      problems: problems.slice(0, 20).map((p) => ({
        reason: p.reason,
        blockType: p.blockType,
        ordinal: p.ordinal,
        field: p.field,
        ...(p.blockId ? { blockId: p.blockId } : {}),
        message: p.message,
      })),
    });
  }
  let count = 0;
  function visit(value: unknown, depth: number, key = "") {
    if (++count > 50000 || depth > 30)
      throw new AppError(
        422,
        "INVALID_CONTENT",
        "Article nesting or size exceeds the limit.",
      );
    // 兜底：findContentProblems 只看块的 props / content，这里覆盖其余任意位置。
    if (
      typeof value === "string" &&
      ["url", "href", "src"].includes(key) &&
      value &&
      !isAllowedLink(key, value)
    )
      throw new AppError(
        422,
        "UNSAFE_URL",
        "文章里有无效链接：只支持 https://、mailto: 或站内上传的文件。",
      );
    if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      for (const [k, v] of Object.entries(object)) visit(v, depth + 1, k);
    }
  }
  visit(blocks, 0);
}
/** 嵌入链接是否可保存：与阅读页、编辑器共用 src/modules/embed 的严格解析。 */
export function isSafeEmbed(url: string) {
  return parseEmbed(url).ok;
}
export function referencesMedia(post: Post, id: string) {
  const url = `/api/files/${id}`;
  return (
    post.coverImage === url || JSON.stringify(post.blocks).includes(`"${url}"`)
  );
}
export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || "untitled"
  );
}
