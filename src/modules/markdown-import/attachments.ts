import { throwIfAborted } from "../../shared/request-cancellation.ts";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent, Definition } from "mdast";
import {
  MAX_DOCUMENT_CHARS,
  HARD_MAX_UPLOAD_BYTES,
  MEDIA_MIME_LIST,
  MAX_MARKDOWN_MEDIA_REFERENCES,
} from "../config/limits.ts";

export type MediaReference = {
  start: number;
  end: number;
  target: string;
  label: string;
  wiki: boolean;
};
export type Attachment = { path: string; file: File };
export type ResolveOptions = {
  mode: "selected" | "root";
  documentPath?: string;
};
export type UploadedAttachment = { url: string; mime: string };
export type AttachmentCache = Map<File, UploadedAttachment>;

/** 只扫描 Markdown 真正的媒体节点；代码块、行内代码和转义不触发磁盘读取。 */
export function mediaReferences(markdown: string): MediaReference[] {
  if (markdown.length > MAX_DOCUMENT_CHARS)
    throw new Error("Markdown 超过正文上限，请拆分后导入。");
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  const ignored: [number, number][] = [];
  const links: [number, number][] = [];
  const refs: MediaReference[] = [];
  const key = (value: string) => value.replace(/\s+/g, " ").toUpperCase();
  const add = (reference: MediaReference) => {
    if (refs.length >= MAX_MARKDOWN_MEDIA_REFERENCES)
      throw new Error(
        `单次导入最多支持 ${MAX_MARKDOWN_MEDIA_REFERENCES} 处媒体引用，请拆分导入。`,
      );
    refs.push(reference);
  };
  const walk = (nodes: RootContent[], collect = false, withinLink = false) => {
    for (const node of nodes) {
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (node.type === "definition")
        definitions.set(key(node.identifier), node);
      const inLink =
        withinLink || node.type === "link" || node.type === "linkReference";
      if (collect && start !== undefined && end !== undefined) {
        if (node.type === "link" || node.type === "linkReference")
          links.push([start, end]);
        if (
          withinLink &&
          (node.type === "image" || node.type === "imageReference")
        )
          throw new Error(
            "暂不支持链接包裹图片，请将图片移出链接后导入；原文已保留。",
          );
        if (
          [
            "code",
            "inlineCode",
            "definition",
            "image",
            "imageReference",
            "html",
          ].includes(node.type)
        )
          ignored.push([start, end]);
        if (node.type === "image")
          add({
            start,
            end,
            target: node.url,
            label: node.alt || "",
            wiki: false,
          });
        if (node.type === "imageReference") {
          const definition = definitions.get(key(node.identifier));
          if (!definition) throw new Error("图片引用缺少 Markdown 链接定义。");
          add({
            start,
            end,
            target: definition.url,
            label: node.alt || "",
            wiki: false,
          });
        }
        // HTML 保持不可执行；媒体标签容易造成“已导入但没有图片”的误解，明确拒绝。
        if (
          node.type === "html" &&
          /<(?:img|video|audio|source)\b/i.test(node.value)
        )
          throw new Error(
            "暂不支持 HTML 媒体标签，请改用 ![说明](附件路径) 或 ![[附件路径]]。",
          );
      }
      if ("children" in node)
        walk(node.children as RootContent[], collect, inLink);
    }
  };
  walk(tree.children);
  walk(tree.children, true);
  // 合并区间并单向推进，避免每个 wiki 都扫描全部代码/HTML/图片区间。
  const intervalCursor = (ranges: [number, number][]) => {
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1])
        previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
    }
    let index = 0;
    return (offset: number) => {
      while (index < merged.length && merged[index][1] <= offset) index++;
      return index < merged.length && merged[index][0] <= offset;
    };
  };
  const isIgnored = intervalCursor(ignored),
    isLinked = intervalCursor(links);
  for (const match of markdown.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    const start = match.index!,
      end = start + match[0].length;
    if (isIgnored(start)) continue;
    let escapes = 0;
    for (let i = start - 1; i >= 0 && markdown[i] === "\\"; i--) escapes++;
    if (escapes % 2) continue;
    if (isLinked(start))
      throw new Error(
        "暂不支持链接包裹图片，请将图片移出链接后导入；原文已保留。",
      );
    const [target, alias] = match[1].split("|");
    add({
      start,
      end,
      target: target.trim(),
      label:
        alias && !/^\d+(?:x\d+)?$/.test(alias)
          ? alias
          : target.split("/").at(-1)!,
      wiki: true,
    });
  }
  return refs.sort((a, b) => a.start - b.start);
}

export function isHostedMedia(target: string) {
  if (/^\/api\/files\/[a-zA-Z0-9-]+$/.test(target)) return true;
  if (!/^https:\/\//i.test(target)) return false;
  try {
    const url = new URL(target);
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

function localTarget(value: string, wiki: boolean): string {
  // 分隔符解码后再检查，避免 %2f / %5c 绕过根目录限制。
  let path: string;
  try {
    // wiki 链接引用 vault 的字面文件名；只有标准 Markdown URL 解码一次。
    path = wiki
      ? value.split(/[?#]/)[0]
      : decodeURIComponent(value.split(/[?#]/)[0]);
  } catch {
    throw new Error(`附件路径编码无效：${value}`);
  }
  if (
    !path ||
    /[\u0000-\u001f\u007f\\]/.test(path) ||
    path.startsWith("/") ||
    /^[^/]*:/.test(path)
  )
    throw new Error(`附件路径不安全或不支持：${value}`);
  return path.normalize("NFC");
}
function normalized(path: string) {
  const result: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!result.length) throw new Error(`附件路径越界：${path}`);
      result.pop();
    } else result.push(part);
  }
  return result.join("/");
}

/** MIME 来源是文件本身，扩展名只补全浏览器/Obsidian 没给 MIME 的情况；服务端仍检查真实字节。 */
const extensionMime: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  pdf: "application/pdf",
};
export function attachmentFile(file: File) {
  const expected =
    extensionMime[file.name.split(".").at(-1)?.toLowerCase() || ""];
  // 不把笔记、脚本、压缩包等当作 wiki 嵌入附件上传。
  if (
    !expected ||
    (file.type &&
      file.type !== "application/octet-stream" &&
      !(MEDIA_MIME_LIST as readonly string[]).includes(file.type))
  )
    throw new Error(`不支持此嵌入附件格式：${file.name}`);
  if (file.type && file.type !== "application/octet-stream") return file;
  return new File([file], file.name, {
    type: expected,
    lastModified: file.lastModified,
  });
}
export function attachmentPlan(
  markdown: string,
  assets: Attachment[],
  options: ResolveOptions,
) {
  // File/vault 的路径是已解码的真实文件名，不能再 decodeURIComponent（100%.png 等）。
  const catalogPath = (path: string) => {
    if (
      !path ||
      /[\u0000-\u001f\u007f\\]/.test(path) ||
      path.startsWith("/") ||
      /^[^/]*:/.test(path)
    )
      throw new Error("附件目录路径不安全。");
    return normalized(path.normalize("NFC"));
  };
  const paths = assets.flatMap((asset) => {
    try {
      return [{ asset, path: catalogPath(asset.path) }];
    } catch {
      return [];
    }
  });
  const documentPath = options.documentPath
    ? catalogPath(options.documentPath)
    : "";
  return mediaReferences(markdown)
    .filter((ref) => !isHostedMedia(ref.target))
    .map((ref) => {
      const target = localTarget(ref.target, ref.wiki);
      let matches: typeof paths;
      if (options.mode === "root") {
        const base = documentPath.split("/").slice(0, -1).join("/");
        const relative = normalized(`${base ? `${base}/` : ""}${target}`);
        // 标准 Markdown 只接受相对笔记路径；wiki 还允许 vault 根路径与唯一文件名。
        let rootTarget = "";
        if (ref.wiki) {
          try {
            rootTarget = normalized(target);
          } catch {
            // 笔记相对解释已通过上面的边界校验；仅丢弃越界的“vault根相对”候选。
            // 最终仍只在显式 File/vault 目录表中匹配，无法读取根目录外的文件。
            rootTarget = "";
          }
        }
        const exact = paths.filter(
          (item) =>
            item.path === relative || (ref.wiki && item.path === rootTarget),
        );
        matches = exact.length
          ? exact
          : ref.wiki && !target.includes("/")
            ? paths.filter((item) => item.path.split("/").at(-1) === target)
            : [];
      } else {
        // 多文件选择仅以显式 File capability 为边界，不按相对路径读取用户磁盘。
        matches = paths.filter(
          (item) => item.path.split("/").at(-1) === target.split("/").at(-1),
        );
      }
      if (!matches.length)
        throw new Error(
          `缺少附件：${ref.target}。请选择该附件，或选择包含笔记和附件的共同上级文件夹。`,
        );
      if (matches.length !== 1)
        throw new Error(
          `附件同名或路径有歧义：${ref.target}。请使用完整路径并选择共同上级文件夹。`,
        );
      const asset = matches[0].asset;
      attachmentFile(asset.file);
      if (asset.file.size > HARD_MAX_UPLOAD_BYTES)
        throw new Error(`附件超过上传硬上限：${asset.file.name}`);
      return { ref, asset };
    });
}
const escapedLabel = (label: string) => label.replace(/[\[\]\\\r\n]/g, " ");
export async function prepareAttachments(
  markdown: string,
  assets: Attachment[],
  options: ResolveOptions,
  upload: (file: File, signal?: AbortSignal) => Promise<UploadedAttachment>,
  execution: {
    signal?: AbortSignal;
    cache?: AttachmentCache;
    progress?: (done: number, total: number) => void;
    readFile?: (asset: Attachment) => Promise<File>;
  } = {},
) {
  const plan = attachmentPlan(markdown, assets, options);
  const cache = execution.cache || new Map<File, UploadedAttachment>();
  const sources = new Map(plan.map((item) => [item.asset.file, item.asset]));
  const byStart = new Map(plan.map((item) => [item.ref.start, item]));
  const unique = [...sources.keys()];
  let done = 0;
  for (const file of unique) {
    throwIfAborted(execution.signal);
    if (!cache.has(file)) {
      const source = sources.get(file)!;
      const picked = attachmentFile(
        execution.readFile ? await execution.readFile(source) : file,
      );
      if (picked.size > HARD_MAX_UPLOAD_BYTES)
        throw new Error(`附件超过上传硬上限：${picked.name}`);
      throwIfAborted(execution.signal);
      const result = await upload(picked, execution.signal);
      if (!/^\/api\/files\/[a-zA-Z0-9-]+$/.test(result.url))
        throw new Error("上传返回了无效的本站媒体地址，已停止导入。");
      cache.set(file, result);
    }
    throwIfAborted(execution.signal);
    execution.progress?.(++done, unique.length);
  }
  const mimeByUrl: Record<string, string> = {};
  const replacements = mediaReferences(markdown).map((ref) => {
    const item = byStart.get(ref.start);
    const result = item ? cache.get(item.asset.file)! : undefined;
    if (result) mimeByUrl[result.url] = result.mime;
    return { ...ref, url: result?.url || ref.target };
  });
  let rewritten = markdown;
  for (const ref of replacements.reverse())
    rewritten =
      rewritten.slice(0, ref.start) +
      `\n\n![${escapedLabel(ref.label)}](${ref.url.replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(" ", "%20")})\n\n` +
      rewritten.slice(ref.end);
  return { markdown: rewritten, mimeByUrl };
}

/** 无扩展名的本站视频 URL 依据上传响应的真实 MIME 转块，GIF 仍是 image。 */
export function applyMediaKinds<T>(
  blocks: T[],
  mimeByUrl: Record<string, string>,
): T[] {
  return blocks.map((raw) => {
    const block = raw as {
      type: string;
      props?: Record<string, unknown>;
      children?: unknown[];
    };
    const url = String(block.props?.url || "");
    const mime =
      mimeByUrl[url] ||
      (url.match(/\.(mp4|webm|mov)(?:[?#]|$)/i) ? "video/" : "");
    const type = mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : mime === "application/pdf"
          ? "file"
          : block.type;
    return {
      ...block,
      type,
      ...(block.children
        ? { children: applyMediaKinds(block.children, mimeByUrl) }
        : {}),
    } as T;
  });
}
