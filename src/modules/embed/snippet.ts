import { parseEmbed } from "./registry";
import type { EmbedParseResult } from "./types";

/** 官方嵌入代码一般不到 2 KB；再长就不是“复制的嵌入代码”了，直接拒绝。 */
export const MAX_EMBED_INPUT_LENGTH = 20_000;
/** 只读取 href / src 属性值；不解析、不渲染其余 HTML。 */
const LINK_ATTRIBUTE = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

export type EmbedInputResult = EmbedParseResult & {
  /** 输入是不是一段 HTML 嵌入代码（而不是链接）。 */
  fromSnippet: boolean;
};

/** 嵌入代码里的属性值只需处理少数实体；其余原样交给 parseEmbed 严格校验。 */
function decodeAttribute(value: string) {
  return value
    .trim()
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, "&")
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#x0*2f;|&#0*47;/gi, "/");
}

/**
 * 从作者粘贴的内容里取出嵌入链接：普通链接原样交给 parseEmbed；以 "<" 开头的
 * 官方嵌入代码（X 的 blockquote、YouTube / Bilibili 的 iframe）只用正则取出
 * href / src 属性值，逐个走 parseEmbed 严格校验，取第一个支持的链接。
 * 粘贴的 HTML 永远不会被渲染或执行，其中的 <script>（如 widgets.js）被忽略。
 * 协议相对的 "//player.bilibili.com/…" 补成 https:。纯函数，不记录日志。
 */
export function parseEmbedInput(value: unknown): EmbedInputResult {
  if (typeof value !== "string")
    return { ok: false, reason: "not_string", fromSnippet: false };
  const input = value.trim();
  if (!input.startsWith("<"))
    return { ...parseEmbed(input), fromSnippet: false };
  if (input.length > MAX_EMBED_INPUT_LENGTH)
    return { ok: false, reason: "too_long", fromSnippet: true };
  for (const m of input.matchAll(LINK_ATTRIBUTE)) {
    let candidate = decodeAttribute(m[1] ?? m[2] ?? "");
    if (candidate.startsWith("//")) candidate = `https:${candidate}`;
    const result = parseEmbed(candidate);
    if (result.ok) return { ...result, fromSnippet: true };
  }
  return { ok: false, reason: "snippet_without_link", fromSnippet: true };
}

/** 看起来像一段 HTML（作者把嵌入代码粘进了链接框）。 */
export function looksLikeEmbedSnippet(value: unknown) {
  return typeof value === "string" && value.trim().startsWith("<");
}
