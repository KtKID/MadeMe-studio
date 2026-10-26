import type { EditorBlock, JSONValue } from "../../shared/contracts";
type Inline =
  | { type: "text"; text: string; styles: Record<string, boolean> }
  | { type: "link"; href: string; content: Inline[] };
function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re =
    /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|(`+)(.*?)\3|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*]+)\*|_([^_]+)_/g;
  let cursor = 0;
  for (const match of text.matchAll(re)) {
    if (match.index! > cursor)
      out.push({
        type: "text",
        text: text.slice(cursor, match.index),
        styles: {},
      });
    if (match[1]) {
      const href = match[2];
      if (
        /^https:\/\//i.test(href) ||
        /^\/api\/files\/[a-zA-Z0-9-]+$/.test(href) ||
        /^mailto:/.test(href)
      )
        out.push({
          type: "link",
          href,
          content: [{ type: "text", text: match[1], styles: {} }],
        });
      else out.push({ type: "text", text: match[1], styles: {} });
    } else {
      const raw =
        match[4] ??
        match[5] ??
        match[6] ??
        match[7] ??
        match[8] ??
        match[9] ??
        "";
      out.push({
        type: "text",
        text: raw,
        styles: match[3]
          ? { code: true }
          : match[5] || match[6]
            ? { bold: true }
            : match[7]
              ? { strike: true }
              : { italic: true },
      });
    }
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length)
    out.push({ type: "text", text: text.slice(cursor), styles: {} });
  return out;
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
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const result: EditorBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
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
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      result.push(
        block("checkListItem", task[2], { checked: task[1] !== " " }),
      );
      i++;
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      result.push(block("bulletListItem", bullet[1]));
      i++;
      continue;
    }
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (number) {
      result.push(block("numberedListItem", number[1]));
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
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((v) => inline(v.trim()));
      const rows = [{ cells: cells(line) }];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push({ cells: cells(lines[i++]) });
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
