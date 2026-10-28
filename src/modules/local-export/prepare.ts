/**
 * 准备一次明确的当前稿快照。纯函数，不取文章、不取媒体、不申请目录权限；
 * 浏览器与其他导出适配器共用这一边界，不让文章/媒体模块反向依赖 Obsidian。
 */
import type { EditorBlock } from "../../shared/contracts";
import { parseEmbed } from "../embed/registry";
import {
  exportSnapshotSchema,
  preparedExportSchema,
  type ExportSnapshot,
  type PreparedExport,
  type ExportMedia,
} from "./contracts";

function safeUrl(raw: string, origin: string): URL {
  // 解析错误交由调用者显示并统一记录日志，不能静默略过缺图。
  const url = new URL(raw, origin);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("媒体链接不支持本地完整导出，请先上传该媒体后重试。");
  return url;
}
function label(text: string): string {
  return text.replace(/[\\\[\]\r\n]/g, " ");
}

/** 跳过代码围栏与行内代码，只把可渲染 Markdown 交给重写函数。 */
function mapMarkdownOutsideCode(
  markdown: string,
  rewrite: (text: string) => string,
): string {
  const rewriteInline = (text: string): string => {
    const ticks = /`+/g;
    let result = "",
      offset = 0;
    let opening: RegExpExecArray | null;
    while ((opening = ticks.exec(text))) {
      // 转义反引号不是代码跨度起点。
      const slash = text.slice(0, opening.index).match(/\\+$/)?.[0].length ?? 0;
      if (slash % 2) continue;
      const start = opening.index;
      const size = opening[0].length;
      let closing: RegExpExecArray | null;
      while ((closing = ticks.exec(text))) {
        if (closing[0].length !== size) continue;
        result += rewrite(text.slice(offset, start));
        result += text.slice(start, ticks.lastIndex);
        offset = ticks.lastIndex;
        break;
      }
      if (!closing) break;
    }
    return result + rewrite(text.slice(offset));
  };
  let result = "",
    plain = "";
  let fence: { marker: string; length: number } | undefined;
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*?)(?:\r?\n)?$/);
    if (fence) {
      result += line;
      if (
        marker &&
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    } else if (marker) {
      result += rewriteInline(plain) + line;
      plain = "";
      fence = { marker: marker[1][0], length: marker[1].length };
    } else plain += line;
  }
  return result + rewriteInline(plain);
}

/** 只替换完整 Markdown 链接目标，避免误改代码示例、普通正文、绝对 URL 子串或相似 ID。 */
export function replaceMarkdownMediaUrl(
  markdown: string,
  from: string,
  to: string,
): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\]\\(\\s*<?)${escaped}(?=[\\s)>])`, "g");
  return mapMarkdownOutsideCode(markdown, (text) =>
    text.replace(pattern, (_match, prefix: string) => `${prefix}${to}`),
  );
}

export function prepareExport(
  input: ExportSnapshot,
  origin: string,
): PreparedExport {
  const snapshot = exportSnapshotSchema.parse(input);
  const base = new URL(origin).origin;
  let markdown = `# ${snapshot.title.replace(/[\r\n]/g, " ") || "无标题"}\n\n${snapshot.markdown}`;
  const media = new Map<string, ExportMedia>();
  const warnings = [
    "Markdown 转换有损：特殊块、样式和交互可能无法还原，请检查导出内容；网站原稿不会改变。",
  ];
  const retainLink = (url: string) => {
    safeUrl(url, base);
    if (!markdown.includes(url)) markdown += `\n\n[查看原始内容](<${url}>)`;
    if (!warnings.some((warning) => warning.includes("平台")))
      warnings.push(
        "平台视频和嵌入仅保留原始链接，不会下载平台内容，离线时可能不可播放。",
      );
  };
  const addMedia = (
    raw: string,
    name: string,
    image: boolean,
    caption: string,
  ) => {
    if (!raw.trim())
      throw new Error("存在未填写链接的图片或媒体，请补全后再导出。");
    const url = safeUrl(raw, base);
    const local =
      url.origin === base && /^\/api\/files\/[^/]+$/.test(url.pathname);
    const id = local
      ? decodeURIComponent(url.pathname.slice("/api/files/".length))
      : url.href;
    const previous = media.get(id);
    if (previous) {
      // 同 ID 的 URL 别名只下载一次，统一正文引用供目录适配器重写。
      if (raw !== previous.url)
        markdown = replaceMarkdownMediaUrl(markdown, raw, previous.url);
      if (
        replaceMarkdownMediaUrl(
          markdown,
          previous.url,
          "__local_export_reference__",
        ) === markdown
      )
        markdown += `\n\n${image ? "!" : ""}[${label(caption)}](${previous.url})`;
      return;
    }
    const fallbackName = decodeURIComponent(
      url.pathname.split("/").pop() || "媒体",
    );
    media.set(id, { id, url: raw, name: name || fallbackName });
    // BlockNote 有损转换可能漏掉封面、附件或特殊块，必须显式保留引用。
    if (
      replaceMarkdownMediaUrl(markdown, raw, "__local_export_reference__") ===
      markdown
    )
      markdown += `\n\n${image ? "!" : ""}[${label(caption)}](${raw})`;
  };
  const visit = (blocks: EditorBlock[]) => {
    for (const block of blocks) {
      const props =
        block.props &&
        typeof block.props === "object" &&
        !Array.isArray(block.props)
          ? block.props
          : {};
      const url = typeof props.url === "string" ? props.url : "";
      const name = typeof props.name === "string" ? props.name : "";
      if (block.type === "embed") {
        if (!url.trim()) throw new Error("嵌入块没有链接，请补全后再导出。");
        retainLink(url);
      } else if (
        ["image", "audio", "video", "file"].includes(String(block.type))
      ) {
        if (block.type === "video" && parseEmbed(url).ok) retainLink(url);
        else addMedia(url, name, block.type === "image", name || "媒体");
      }
      if (Array.isArray(block.children)) visit(block.children as EditorBlock[]);
    }
  };
  visit(snapshot.blocks);
  if (snapshot.coverUrl) addMedia(snapshot.coverUrl, "", true, "封面");
  return preparedExportSchema.parse({
    articleId: snapshot.articleId,
    title: snapshot.title,
    markdown: `${markdown.trimEnd()}\n`,
    media: [...media.values()],
    warnings,
  });
}
