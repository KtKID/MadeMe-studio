import type { CSSProperties, ReactNode } from "react";
import { safeUrl } from "../shared/ui";
type Block = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
};
const readerPalette = new Set([
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
]);
/** 样式只由固定属性和白名单值组成，绝不拼接用户提供的 CSS 文本。 */
function safeColor(
  value: unknown,
  channel: "text" | "background",
): string | undefined {
  if (typeof value !== "string" || value === "default") return undefined;
  if (readerPalette.has(value)) return `var(--reader-${value}-${channel})`;
  return /^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(
    value,
  )
    ? value
    : undefined;
}
function safeBlockStyle(
  props: Record<string, unknown> | undefined,
): CSSProperties {
  const alignment = props?.textAlignment;
  return {
    textAlign:
      typeof alignment === "string" &&
      ["left", "center", "right", "justify"].includes(alignment)
        ? (alignment as CSSProperties["textAlign"])
        : undefined,
    color: safeColor(props?.textColor, "text"),
    backgroundColor: safeColor(props?.backgroundColor, "background"),
  };
}
function safeImageWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(32, Math.min(4096, Math.round(value)))
    : undefined;
}
function Inline({ value }: { value: unknown }): ReactNode {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  return value.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    const v = item as {
      type?: string;
      text?: string;
      content?: unknown;
      href?: string;
      styles?: Record<string, unknown>;
    };
    if (v.type === "link") {
      const url = safeUrl(v.href);
      return url ? (
        <a key={i} href={url} rel="noopener noreferrer">
          <Inline value={v.content} />
        </a>
      ) : (
        <Inline key={i} value={v.content} />
      );
    }
    let text: ReactNode = v.text || "";
    const s = v.styles || {};
    if (s.code) text = <code>{text}</code>;
    if (s.bold) text = <strong>{text}</strong>;
    if (s.italic) text = <em>{text}</em>;
    if (s.underline) text = <u>{text}</u>;
    if (s.strike) text = <s>{text}</s>;
    return (
      <span
        key={i}
        style={{
          color: safeColor(s.textColor, "text"),
          backgroundColor: safeColor(s.backgroundColor, "background"),
        }}
      >
        {text}
      </span>
    );
  });
}
export function embedUrl(
  value: unknown,
): { type: "youtube" | "x"; url: string; embed?: string } | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return null;
    if (["youtube.com", "www.youtube.com", "youtu.be"].includes(u.hostname)) {
      const id =
        u.hostname === "youtu.be"
          ? u.pathname.slice(1)
          : u.searchParams.get("v") || u.pathname.split("/").filter(Boolean)[1];
      if (id && /^[\w-]{11}$/.test(id))
        return {
          type: "youtube",
          url: u.href,
          embed: `https://www.youtube-nocookie.com/embed/${id}`,
        };
    }
    if (
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
        u.hostname,
      ) &&
      /^\/[a-zA-Z0-9_]+\/status\/\d+\/?$/.test(u.pathname)
    )
      return { type: "x", url: u.href };
    return null;
  } catch {
    return null;
  }
}
export function SafeEmbed({ url }: { url: unknown }) {
  const embed = embedUrl(url);
  if (!embed)
    return (
      <div className="embed-fallback">
        无法显示：仅支持有效的 YouTube 或 X 内容链接。
      </div>
    );
  return embed.type === "youtube" ? (
    <div className="video-embed">
      <iframe
        src={embed.embed}
        title="YouTube 视频"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  ) : (
    <a
      className="x-embed"
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="x-logo">𝕏</span>
      <span>
        在 X 上阅读这条动态<small>{embed.url}</small>
      </span>
      <span>↗</span>
    </a>
  );
}
function safeSpan(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1000
    ? value
    : 1;
}
function listStart(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= 1000000
    ? value
    : undefined;
}
function TableBlock({ value }: { value: unknown }) {
  const table =
    value && typeof value === "object"
      ? (value as {
          rows?: unknown;
          headerRows?: unknown;
          headerCols?: unknown;
        })
      : {};
  const rows = Array.isArray(table.rows)
    ? table.rows.filter(
        (row): row is { cells: unknown[] } =>
          !!row &&
          typeof row === "object" &&
          Array.isArray((row as { cells?: unknown }).cells),
      )
    : [];
  const headerRows =
    typeof table.headerRows === "number" && Number.isInteger(table.headerRows)
      ? Math.max(0, Math.min(table.headerRows, rows.length))
      : 0;
  const headerCols =
    typeof table.headerCols === "number" && Number.isInteger(table.headerCols)
      ? Math.max(0, Math.min(table.headerCols, 1000))
      : 0;
  const occupied: number[] = [];
  const rendered = rows.map((row, rowIndex) => {
    let column = 0;
    const cells = row.cells.map((raw, index) => {
      while ((occupied[column] || 0) > rowIndex) column++;
      const cell =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as { content?: unknown; props?: Record<string, unknown> })
          : null;
      const colspan = safeSpan(cell?.props?.colspan),
        rowspan = safeSpan(cell?.props?.rowspan);
      const headerRow = rowIndex < headerRows,
        headerColumn = column < headerCols;
      const Tag = headerRow || headerColumn ? "th" : "td";
      for (let n = 0; n < colspan; n++)
        occupied[column + n] = rowIndex + rowspan;
      column += colspan;
      return (
        <Tag
          key={index}
          colSpan={colspan}
          rowSpan={rowspan}
          style={safeBlockStyle(cell?.props)}
          scope={
            headerRow
              ? colspan > 1
                ? "colgroup"
                : "col"
              : headerColumn
                ? rowspan > 1
                  ? "rowgroup"
                  : "row"
                : undefined
          }
        >
          <Inline value={cell ? cell.content : raw} />
        </Tag>
      );
    });
    return <tr key={rowIndex}>{cells}</tr>;
  });
  return (
    <div className="table-scroll">
      <table>
        {headerRows > 0 && <thead>{rendered.slice(0, headerRows)}</thead>}
        <tbody>{rendered.slice(headerRows)}</tbody>
      </table>
    </div>
  );
}
function ListGroup({
  blocks,
  numbered,
}: {
  blocks: Block[];
  numbered: boolean;
}) {
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag start={numbered ? listStart(blocks[0]?.props?.start) : undefined}>
      {blocks.map((block, index) => (
        <li
          key={block.id || index}
          style={safeBlockStyle(block.props)}
          value={
            numbered && index > 0 ? listStart(block.props?.start) : undefined
          }
        >
          <Inline value={block.content} />
          {Array.isArray(block.children) && block.children.length > 0 && (
            <BlockReader blocks={block.children} />
          )}
        </li>
      ))}
    </Tag>
  );
}
function One({ block }: { block: Block }) {
  if (!block || typeof block !== "object") return null;
  const p = block.props || {};
  const content = <Inline value={block.content} />;
  const url = safeUrl(p.url);
  let element: ReactNode;
  switch (block.type) {
    case "heading":
      element =
        p.level === 1 ? (
          <h1>{content}</h1>
        ) : p.level === 3 ? (
          <h3>{content}</h3>
        ) : (
          <h2>{content}</h2>
        );
      break;
    case "bulletListItem":
      element = (
        <ul>
          <li>{content}</li>
        </ul>
      );
      break;
    case "numberedListItem":
      element = (
        <ol start={Number(p.start) || 1}>
          <li>{content}</li>
        </ol>
      );
      break;
    case "checkListItem":
      element = (
        <p className="reader-check">
          <input
            type="checkbox"
            checked={!!p.checked}
            readOnly
            aria-label="任务状态"
          />
          {content}
        </p>
      );
      break;
    case "quote":
      element = <blockquote>{content}</blockquote>;
      break;
    case "codeBlock":
      element = (
        <pre>
          <code>{content}</code>
        </pre>
      );
      break;
    case "image":
      element = url ? (
        <figure
          style={{
            textAlign:
              p.textAlignment === "right"
                ? "right"
                : p.textAlignment === "center"
                  ? "center"
                  : "left",
          }}
        >
          <img
            src={url}
            alt={String(p.caption || p.name || "文章图片")}
            loading="lazy"
            width={safeImageWidth(p.previewWidth)}
          />
          {!!p.caption && <figcaption>{String(p.caption)}</figcaption>}
        </figure>
      ) : null;
      break;
    case "video":
      element = url ? <video src={url} controls preload="metadata" /> : null;
      break;
    case "audio":
      element = url ? <audio src={url} controls preload="metadata" /> : null;
      break;
    case "file":
      element = url ? (
        <a className="file-attachment" href={url} download rel="noreferrer">
          ↧ {String(p.name || "下载附件")}
        </a>
      ) : null;
      break;
    case "embed":
      element = <SafeEmbed url={p.url} />;
      break;
    case "table":
      element = <TableBlock value={block.content} />;
      break;
    default:
      element = <p>{content}</p>;
  }
  return (
    <div className="reader-block" style={safeBlockStyle(p)}>
      {element}
      {Array.isArray(block.children) && block.children.length ? (
        <div className="reader-children">
          <BlockReader blocks={block.children} />
        </div>
      ) : null}
    </div>
  );
}
export default function BlockReader({ blocks }: { blocks: unknown[] }) {
  const valid = blocks.filter(
    (block): block is Block =>
      !!block && typeof block === "object" && !Array.isArray(block),
  );
  const output: ReactNode[] = [];
  for (let index = 0; index < valid.length;) {
    const block = valid[index];
    if (block.type === "numberedListItem" || block.type === "bulletListItem") {
      let end = index + 1;
      while (end < valid.length && valid[end].type === block.type) end++;
      output.push(
        <ListGroup
          key={block.id || index}
          blocks={valid.slice(index, end)}
          numbered={block.type === "numberedListItem"}
        />,
      );
      index = end;
    } else {
      output.push(<One key={block.id || index} block={block} />);
      index++;
    }
  }
  return <>{output}</>;
}
