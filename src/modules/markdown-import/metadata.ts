import { parseDocument, isMap } from "yaml";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Heading, PhrasingContent } from "mdast";
import { mediaReferences } from "./attachments";
import { TEXT_LIMITS } from "../config/limits";

/** 网页导入只接收明确的三个字段，其余文件头不进入文章。 */
export function parseImportMetadata(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const opening = /^---[ \t]*\n/.exec(normalized);
  const unchanged = {
    markdown: normalized,
    cid: undefined,
    title: undefined,
    cover: undefined,
  };
  if (!opening) return unchanged;
  const rest = normalized.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\n|$)/m.exec(rest);
  if (!closing) {
    const firstParagraph = rest.split(/\n[ \t]*\n/, 1)[0];
    if (
      firstParagraph
        .split("\n")
        .some((line) => /^[ \t]*(?:cid|cover|title)[ \t]*:/i.test(line))
    )
      throw new Error("Markdown 文件头缺少结束标记。");
    return unchanged;
  }
  const header = rest.slice(0, closing.index).replace(/\n$/, "");
  const bodyOffset = opening[0].length + closing.index + closing[0].length;
  const doc = parseDocument(header, { uniqueKeys: true });
  const looksLikeFields = /^[ \t]*[\w-]+[ \t]*:/m.test(header);
  if (doc.errors.length) {
    if (looksLikeFields) throw new Error("Markdown 文件头格式有误。");
    return unchanged;
  }
  if (!doc.contents)
    return { ...unchanged, markdown: normalized.slice(bodyOffset) };
  if (!isMap(doc.contents)) return unchanged;
  const data = doc.toJS({ maxAliasCount: 20 }) as Record<string, unknown>;
  const field = (key: string, limit: number) => {
    const value = data[key];
    if (value == null || value === "") return undefined;
    if (
      typeof value !== "string" ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      !value.trim() ||
      value.trim().length > limit
    )
      throw new Error(`文件头 ${key} 格式有误。`);
    return value.trim();
  };
  const cover = field("cover", 2048);
  if (cover && /^(?:[a-z]+:|\/|\\\\)/i.test(cover))
    throw new Error("封面请使用相对于 Markdown 的本地图片路径。");
  return {
    markdown: normalized.slice(bodyOffset),
    cid: field("cid", 200),
    title: field("title", TEXT_LIMITS.postTitle),
    cover,
  };
}
/** 网页导入只把正文首块的一级标题用作文章标题。 */
export function prepareImportDocument(raw: string) {
  const metadata = parseImportMetadata(raw);
  const first = fromMarkdown(metadata.markdown).children[0];
  if (first?.type !== "heading" || first.depth !== 1) return metadata;
  const start = first.position?.start.offset;
  const end = first.position?.end.offset;
  // CommonMark 把 Obsidian 嵌入当作文本；用附件扫描区分嵌入、转义和代码示例。
  if (
    start !== undefined &&
    end !== undefined &&
    metadata.markdown.slice(start, end).includes("![[") &&
    mediaReferences(metadata.markdown).some(
      (ref) => ref.wiki && ref.start >= start && ref.end <= end,
    )
  )
    return metadata;
  // mdast 已处理 Markdown 转义、强调和标题结尾标记，提取用户看到的文字。
  function headingText(node: Heading | PhrasingContent): string | null {
    switch (node.type) {
      case "text":
      case "inlineCode":
        return node.value;
      case "break":
        return " ";
      case "heading":
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "linkReference": {
        const parts = node.children.map(headingText);
        return parts.some((part) => part === null) ? null : parts.join("");
      }
      default:
        return null;
    }
  }
  const heading = headingText(first)?.trim();
  if (heading === undefined) return metadata;
  const usable =
    heading &&
    heading.length <= TEXT_LIMITS.postTitle &&
    !/[\u0000-\u001f\u007f]/.test(heading);
  const title = metadata.title ?? (usable ? heading : undefined);
  const markdown =
    title && heading === title && start !== undefined && end !== undefined
      ? metadata.markdown.slice(0, start) + metadata.markdown.slice(end)
      : metadata.markdown;
  return { ...metadata, title, markdown };
}
/** 固定置首，确保正文代码围栏无法吞掉封面引用。 */
export function appendCoverReference(markdown: string, cover?: string) {
  if (!cover) return markdown;
  const encoded = cover
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return `![封面](<${encoded}>)\n\n${markdown}`;
}
/** 在原始 Markdown 上判断首图，避免附件重写插入的空行改变语义。 */
export function hasStandaloneFirstImage(markdown: string) {
  const node = fromMarkdown(markdown).children.find(
    (item) => item.type !== "heading",
  );
  if (
    node?.type !== "paragraph" ||
    !node.position ||
    node.children.length !== 1
  )
    return false;
  const child = node.children[0];
  const first = mediaReferences(markdown)[0];
  const start = node.position.start.offset,
    end = node.position.end.offset;
  return (
    start !== undefined &&
    end !== undefined &&
    !!first &&
    first.start >= start &&
    first.end <= end &&
    (child.type === "image" ||
      child.type === "imageReference" ||
      (child.type === "text" && /^!\[\[[^\]\n]+\]\]$/.test(child.value.trim())))
  );
}
export function finishCoverImport(
  markdown: string,
  mimeByUrl: Record<string, string>,
  hasCover: boolean,
  removeStandaloneFirst = false,
) {
  if (!hasCover) return { markdown, cover: undefined };
  const refs = mediaReferences(markdown);
  const cover = refs[0];
  if (!cover || markdown.slice(0, cover.start).trim())
    throw new Error("封面处理失败。");
  const mime = mimeByUrl[cover.target];
  if (!mime?.startsWith("image/")) throw new Error("封面必须是图片。");
  const first = refs[1];
  let result = markdown;
  if (removeStandaloneFirst && first && first.target === cover.target)
    result = result.slice(0, first.start) + result.slice(first.end);
  result = result.slice(cover.end).replace(/^\n{1,2}/, "");
  return { markdown: result, cover: cover.target };
}
