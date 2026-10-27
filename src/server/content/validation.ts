import {
  embedProviders,
  parseEmbed,
  reportEmbedRejection,
} from "../../modules/embed";
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
  let count = 0;
  function visit(value: unknown, depth: number, key = "") {
    if (++count > 50000 || depth > 30)
      throw new AppError(
        422,
        "INVALID_CONTENT",
        "Article nesting or size exceeds the limit.",
      );
    if (
      typeof value === "string" &&
      ["url", "href", "src"].includes(key) &&
      value
    ) {
      if (
        !/^https:\/\//i.test(value) &&
        !/^\/api\/files\/[a-zA-Z0-9-]+$/.test(value) &&
        !(key === "href" && /^mailto:[^\s<>]+$/.test(value))
      )
        throw new AppError(
          422,
          "UNSAFE_URL",
          "Content links must use HTTPS, email, or uploaded media.",
        );
    }
    if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (object.type === "embed") {
        const props = object.props as { url?: string } | undefined;
        if (props?.url) {
          const result = parseEmbed(props.url);
          if (!result.ok) {
            reportEmbedRejection("server_validation", result);
            throw new AppError(
              422,
              "UNSAFE_EMBED",
              `Only ${embedProviders.map((p) => p.name).join(", ")} embeds are supported.`,
            );
          }
        }
      }
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
