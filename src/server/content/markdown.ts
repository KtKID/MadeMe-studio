import type { EditorBlock, JSONValue } from "../../shared/contracts";
import { AppError } from "../errors";
type Inline =
  | { type: "text"; text: string; styles: Record<string, boolean> }
  | { type: "link"; href: string; content: Inline[] };
/** 在识别格式前保护转义标点；代码跨度原样跳过，解析完再还原字面字符。 */
function protectEscapedPunctuation(text: string) {
  let marker = "\uE000";
  while (text.includes(marker)) marker += "\uE000";
  const escaped: string[] = [];
  const protectedText = text.replace(
    /(`+)(.*?)\1|\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g,
    (
      match: string,
      ticks: string | undefined,
      _code: string | undefined,
      punctuation: string | undefined,
    ) => {
      if (ticks) return match;
      const index = escaped.push(punctuation!) - 1;
      return `${marker}${index}${marker}`;
    },
  );
  const restore = (value: string) =>
    value.replace(
      new RegExp(`${marker}(\\d+)${marker}`, "g"),
      (_match: string, index: string) => escaped[Number(index)],
    );
  return { text: protectedText, restore };
}
/** 只递归支持明确成对的行内格式；不生成嵌套链接，限制递归层数。 */
function inline(text: string): Inline[] {
  const protectedInput = protectEscapedPunctuation(text);
  const restore = protectedInput.restore;
  function parse(
    source: string,
    styles: Record<string, boolean> = {},
    depth = 0,
    links = true,
  ): Inline[] {
    if (depth > 16)
      throw new AppError(
        422,
        "INVALID_CONTENT",
        "Markdown inline nesting exceeds the limit.",
      );
    const out: Inline[] = [];
    const re =
      /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|(`+)(.*?)\3|\*\*\*(.+?)\*\*\*|___(.+?)___|\*\*(.+?)\*\*(?!\*)|__(.+?)__(?!_)|~~(.+?)~~|\*((?:\*\*.+?\*\*|[^*])+)\*|_((?:__.+?__|[^_])+)_/g;
    let cursor = 0;
    const literal = (value: string) =>
      out.push({ type: "text", text: restore(value), styles: { ...styles } });
    for (const match of source.matchAll(re)) {
      if (match.index! > cursor) literal(source.slice(cursor, match.index));
      if (match[1]) {
        const href = restore(match[2]);
        const label = parse(match[1], styles, depth + 1, false);
        if (
          links &&
          href.length <= 2048 &&
          (/^https:\/\//i.test(href) ||
            /^\/api\/files\/[a-zA-Z0-9-]+$/.test(href) ||
            /^mailto:[^\s<>]+$/.test(href))
        )
          out.push({ type: "link", href, content: label });
        else out.push(...label);
      } else if (match[3]) {
        out.push({
          type: "text",
          text: match[4],
          styles: { ...styles, code: true },
        });
      } else {
        const raw =
          match[5] ??
          match[6] ??
          match[7] ??
          match[8] ??
          match[9] ??
          match[10] ??
          match[11];
        const added: Record<string, boolean> =
          match[5] || match[6]
            ? { bold: true, italic: true }
            : match[7] || match[8]
              ? { bold: true }
              : match[9]
                ? { strike: true }
                : { italic: true };
        out.push(...parse(raw, { ...styles, ...added }, depth + 1, links));
      }
      cursor = match.index! + match[0].length;
    }
    if (cursor < source.length) literal(source.slice(cursor));
    return out;
  }
  return parse(protectedInput.text);
}
/** 分隔符前的反斜线按奇偶配对，避免把转义竖线误当成列。 */
function tableCells(line: string) {
  const source = line.trim();
  const cells: string[] = [];
  let cell = "",
    slashes = 0;
  for (const char of source) {
    if (char === "|" && slashes % 2 === 0) {
      cells.push(cell);
      cell = "";
    } else cell += char;
    slashes = char === "\\" ? slashes + 1 : 0;
  }
  cells.push(cell);
  if (source.startsWith("|")) cells.shift();
  if (cells.at(-1) === "" && source.endsWith("|")) cells.pop();
  return cells.map((value) => inline(value.trim()));
}

function block(
  type: string,
  text: string,
  props: Record<string, JSONValue> = {},
): EditorBlock {
  return {
    id: crypto.randomUUID(),
    type,
    props,
    content: inline(text) as unknown as JSONValue,
    children: [],
  };
}
/** 保守导入 Markdown；原始 HTML 永远作为文字保存，不生成可执行内容。 */
export function markdownToBlocks(markdown: string): EditorBlock[] {
  if (markdown.length > 1_000_000)
    throw new AppError(413, "CONTENT_TOO_LARGE", "Markdown is too large.");
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const result: EditorBlock[] = [];
  const listStack: { indent: number; block: EditorBlock }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      listStack.length = 0;
      i++;
      continue;
    }
    const item = line.match(
      /^([ \t]*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/,
    );
    if (item) {
      const indent = item[1].replace(/\t/g, "    ").length;
      while (listStack.length && listStack.at(-1)!.indent >= indent)
        listStack.pop();
      if (listStack.length >= 10)
        throw new AppError(
          422,
          "INVALID_CONTENT",
          "Markdown list nesting exceeds the limit.",
        );
      const current =
        item[3] !== undefined
          ? block("checkListItem", item[4], { checked: item[3] !== " " })
          : block(
              /\d/.test(item[2]) ? "numberedListItem" : "bulletListItem",
              item[4],
            );
      const parent = listStack.at(-1);
      if (parent) (parent.block.children as EditorBlock[]).push(current);
      else result.push(current);
      listStack.push({ indent, block: current });
      i++;
      continue;
    }
    listStack.length = 0;
    const fence = line.match(/^\s*(`{3,}|~{3,})([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(
          lines[i],
        )
      )
        body.push(lines[i++]);
      if (i < lines.length) i++;
      result.push({
        ...block("codeBlock", "", { language: fence[2] || "text" }),
        content: [{ type: "text", text: body.join("\n"), styles: {} }],
      });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      result.push(
        block("heading", heading[2], { level: Math.min(3, heading[1].length) }),
      );
      i++;
      continue;
    }
    const image = line.match(
      /^!\[([^\]]*)\]\((https:\/\/[^\s)]+|\/api\/files\/[a-zA-Z0-9-]+)(?:\s+"([^"]*)")?\)\s*$/,
    );
    if (image) {
      result.push({
        id: crypto.randomUUID(),
        type: "image",
        props: {
          url: image[2],
          caption: image[1],
          name: image[1],
          showPreview: true,
        },
        children: [],
      });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quotes: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]))
        quotes.push(lines[i++].replace(/^>\s?/, ""));
      result.push(block("quote", quotes.join("\n")));
      continue;
    }
    if (
      i + 1 < lines.length &&
      line.includes("|") &&
      /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])
    ) {
      const rows = [{ cells: tableCells(line) }];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push({ cells: tableCells(lines[i++]) });
      result.push({
        id: crypto.randomUUID(),
        type: "table",
        props: {},
        content: { type: "tableContent", rows } as unknown as JSONValue,
        children: [],
      });
      continue;
    }
    const paragraph = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(?:#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>|\s*`{3}|\s*~{3}|!\[)/.test(
        lines[i],
      )
    )
      paragraph.push(lines[i++]);
    result.push(block("paragraph", paragraph.join("\n")));
  }
  return result.length ? result : [block("paragraph", "")];
}
