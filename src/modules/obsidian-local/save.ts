import { z } from "zod";
import {
  OBSIDIAN_LOCAL_DEFAULTS as defaults,
  IMAGE_DOWNLOAD_TIMEOUT_MS,
  HARD_MAX_UPLOAD_BYTES,
} from "../config/limits";
import { replaceMarkdownMediaUrl } from "../local-export/prepare";
import {
  preparedExportSchema,
  type PreparedExport,
} from "../local-export/contracts";
import type { DirectoryHandle } from "./contracts";
import { verifyVault } from "./presets";

/** 任何规则都在授权根内解析；不接受绝对路径、Windows 路径或隐形控制字符。 */
export function normalizePath(...paths: string[]): string {
  const parts: string[] = [];
  for (const path of paths) {
    if (/^[\/\\]|[:\\\u0000-\u001f]/.test(path))
      throw new Error("目录必须位于授权根目录内。");
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw new Error("图片规则越出了授权根目录。");
        parts.pop();
      } else {
        if (/[. ]$/.test(part)) throw new Error("目录名称不能以点或空格结尾。");
        parts.push(part);
      }
    }
  }
  return parts.join("/");
}
function truncateBytes(value: string, maximum: number) {
  let output = "";
  for (const character of value) {
    if (new TextEncoder().encode(output + character).length > maximum) break;
    output += character;
  }
  return output;
}
export function safeName(name: string): string {
  const cleaned =
    name
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^\.+|[. ]+$/g, "") || "未命名";
  const dot = cleaned.lastIndexOf(".");
  const extension =
    dot > 0 ? truncateBytes(cleaned.slice(dot), defaults.extensionMax) : "";
  const bounded =
    truncateBytes(
      dot > 0 ? cleaned.slice(0, dot) : cleaned,
      defaults.fileNameMax - new TextEncoder().encode(extension).length,
    ) + extension;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(bounded)
    ? `_${bounded}`
    : bounded;
}
const entrySchema = z.object({ path: z.string(), digest: z.string() }).strict();
export const manifestSchema = z
  .object({
    version: z.literal(defaults.manifestVersion),
    articles: z.record(z.string(), entrySchema),
    media: z.record(z.string(), entrySchema),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
export class LocalConflictError extends Error {
  constructor() {
    super("本地文件已修改。请选择另存副本，或明确确认覆盖。");
    this.name = "LocalConflictError";
  }
}
export class MissingDirectoryError extends Error {
  constructor() {
    super("目标目录不存在，请明确创建目录或从文稿选择其他位置。");
    this.name = "MissingDirectoryError";
  }
}
export const saveOptionsSchema = z
  .object({
    noteDirectory: z.string(),
    imageRule: z.string(),
    markdownOnly: z.boolean().optional(),
    createDirectories: z.boolean().optional(),
    conflict: z.enum(["copy", "overwrite"]).optional(),
  })
  .strict();
export type SaveOptions = z.infer<typeof saveOptionsSchema> & {
  fetchMedia?: (url: string) => Promise<Response>;
};
async function directory(root: DirectoryHandle, path: string, create = false) {
  let target = root;
  for (const part of normalizePath(path).split("/").filter(Boolean))
    target = await target.getDirectoryHandle(part, { create });
  return target;
}
async function read(root: DirectoryHandle, path: string): Promise<Blob | null> {
  const parts = normalizePath(path).split("/");
  const name = parts.pop()!;
  try {
    return await (
      await (await directory(root, parts.join("/"))).getFileHandle(name)
    ).getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError")
      return null;
    throw error;
  }
}
async function write(root: DirectoryHandle, path: string, data: Blob | string) {
  const parts = normalizePath(path).split("/");
  const name = parts.pop()!;
  const handle = await (
    await directory(root, parts.join("/"), true)
  ).getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try {
    await stream.write(data);
    await stream.close();
  } catch (error) {
    if (stream.abort) await stream.abort();
    throw error;
  }
}
async function digest(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function suffix(name: string, id: string, index = 0) {
  const dot = name.lastIndexOf(".");
  const ext =
    dot > 0 ? truncateBytes(name.slice(dot), defaults.extensionMax) : "";
  const tail = `-${truncateBytes(safeName(id), defaults.fileSuffixMax)}${index ? `-${index}` : ""}${ext}`;
  return (
    truncateBytes(
      dot > 0 ? name.slice(0, dot) : name,
      defaults.fileNameMax - new TextEncoder().encode(tail).length,
    ) + tail
  );
}
async function freePath(
  root: DirectoryHandle,
  folder: string,
  name: string,
  id: string,
  reserved = new Set<string>(),
) {
  let candidate = [folder, name].filter(Boolean).join("/");
  let i = 0;
  while (
    reserved.has(candidate.normalize("NFC").toLowerCase()) ||
    (await read(root, candidate))
  ) {
    candidate = [folder, suffix(name, id, i++)].filter(Boolean).join("/");
  }
  return candidate;
}
function relative(from: string, to: string) {
  const a = from.split("/").filter(Boolean),
    b = to.split("/").filter(Boolean);
  while (a.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => ".."), ...b].join("/");
}
function mediaDownloadUrl(raw: string) {
  const url = new URL(raw, location.origin);
  if (
    url.origin === location.origin &&
    /^\/api\/files\/[^/]+$/.test(url.pathname)
  )
    url.searchParams.set("download", "1");
  return url.href;
}
const locks = new WeakSet<object>();
/** 全部媒体先取齐；媒体先写、正文最后 close 提交。失败不会把旧正文替换成缺图版本。 */
let pending: Promise<unknown> = Promise.resolve();
export function saveToDirectory(
  root: DirectoryHandle,
  prepared: PreparedExport,
  options: SaveOptions,
): Promise<{ notePath: string }> {
  if (typeof window !== "undefined" && !navigator.locks) {
    return Promise.reject(
      new Error(
        "浏览器缺少安全的跨标签页保存锁，已停止本地目录保存。请使用普通 Markdown 下载，或换用支持 Web Locks 的浏览器。",
      ),
    );
  }
  const run = async () =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("mademe-local-export", () =>
          saveTransaction(root, prepared, options),
        )
      : saveTransaction(root, prepared, options);
  // 多个句柄可能指向相同目录：本页全局排队，支持的浏览器另用 Web Locks 跨标签页串行。
  const result = pending.then(run, run);
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
async function saveTransaction(
  root: DirectoryHandle,
  prepared: PreparedExport,
  options: SaveOptions,
): Promise<{ notePath: string }> {
  if (locks.has(root)) throw new Error("此目录正在保存，请稍后重试。");
  locks.add(root);
  try {
    preparedExportSchema.parse(prepared);
    const { fetchMedia: _fetch, ...serializableOptions } = options;
    saveOptionsSchema.parse(serializableOptions);
    // 旧预设和已授权句柄不是仓库存在的证明；所有保存模式在任何写入前检查实际根。
    if (!(await verifyVault(root)))
      throw new Error("这个路径没有检测到 Obsidian 仓库，请重新选择");
    // 仅正文模式不触碰附件目录；既有媒体清单和文件原样保留。
    const mediaToSave = options.markdownOnly ? [] : prepared.media;
    const noteDirectory = normalizePath(options.noteDirectory),
      imageDirectory = normalizePath(noteDirectory, options.imageRule);
    try {
      await directory(root, noteDirectory, options.createDirectories);
      if (mediaToSave.length)
        await directory(root, imageDirectory, options.createDirectories);
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundError")
        throw new MissingDirectoryError();
      throw error;
    }
    const oldManifest = await read(root, defaults.manifestName);
    const manifest: Manifest = oldManifest
      ? manifestSchema.parse(JSON.parse(await oldManifest.text()))
      : { version: defaults.manifestVersion, articles: {}, media: {} };
    // 不信任可手工编辑的清单路径，同样不得逃逸授权根。
    for (const entry of [
      ...Object.values(manifest.articles),
      ...Object.values(manifest.media),
    ])
      normalizePath(entry.path);
    const tracked = manifest.articles[prepared.articleId];
    const previous =
      tracked?.path.split("/").slice(0, -1).join("/") === noteDirectory
        ? tracked
        : undefined;
    let notePath = previous?.path;
    const before = notePath ? await read(root, notePath) : null;
    const beforeDigest = before ? await digest(before) : null;
    // 清单只记录身份和上次版本；磁盘确认缺失时允许原路径重建，不等于内容被修改。
    if (
      previous &&
      before !== null &&
      beforeDigest !== previous.digest &&
      options.conflict !== "copy" &&
      options.conflict !== "overwrite"
    )
      throw new LocalConflictError();
    if (!notePath || options.conflict === "copy")
      notePath = await freePath(
        root,
        noteDirectory,
        `${safeName(prepared.title)}.md`,
        prepared.articleId,
      );
    // 已跟踪文件只能沿用第一次比对的版本，不能二次读取后悄悄接受本地新修改。
    // 新路径只授权创建“不存在”的文件，规划后出现的陌生文件绝不能升级为覆盖基线。
    const initialDigest = notePath === previous?.path ? beforeDigest : null;
    const downloads = [];
    const reserved = new Set<string>([notePath.normalize("NFC").toLowerCase()]);
    for (const media of mediaToSave) {
      const response = await (
        options.fetchMedia ??
        ((url) =>
          fetch(mediaDownloadUrl(url), {
            signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
            credentials:
              new URL(url, location.origin).origin === location.origin
                ? "same-origin"
                : "omit",
          }))
      )(media.url);
      if (!response.ok)
        throw new Error(
          `附件下载失败（${response.status}），未保存正文，可重试。`,
        );
      if (
        Number(response.headers.get("content-length")) > HARD_MAX_UPLOAD_BYTES
      )
        throw new Error("附件超过本地导出单文件上限，未保存正文。");
      const reader = response.body?.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > HARD_MAX_UPLOAD_BYTES)
              throw new Error("附件超过本地导出单文件上限，未保存正文。");
            chunks.push(new Uint8Array(part.value));
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      const blob = new Blob(chunks, {
        type: response.headers.get("content-type") ?? "",
      });
      if (!blob.size) throw new Error("附件为空，未保存正文。");
      if ((response.headers.get("content-type") ?? "").includes("text/html"))
        throw new Error("附件返回登录页面而非文件，未保存正文。");
      const value = await digest(blob);
      const known = manifest.media[media.id];
      let path: string | undefined;
      let reuseExisting = false;
      if (
        known &&
        known.path.split("/").slice(0, -1).join("/") === imageDirectory &&
        known.digest === value
      ) {
        const local = await read(root, known.path);
        if (local && (await digest(local)) === value) {
          path = known.path;
          reuseExisting = true;
        }
      }
      // 文件名只用于展示，身份以媒体 ID 为准；陌生同名文件绝不覆盖。
      let originalName = media.name;
      // 已有 API 在 download=1 时返回原名；优先保留内容快照的 name。
      if (originalName === media.id) {
        const disposition = response.headers.get("content-disposition") ?? "";
        const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
        const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
        if (encoded) originalName = decodeURIComponent(encoded);
        else if (plain) originalName = plain;
      }
      if (!path)
        path = await freePath(
          root,
          imageDirectory,
          safeName(originalName),
          media.id,
          reserved,
        );
      reserved.add(path.normalize("NFC").toLowerCase());
      downloads.push({
        media,
        blob,
        digest: value,
        path,
        // 只有磁盘上实际存在且内容匹配才复用；原路径被删后也必须补写。
        write: !reuseExisting,
      });
    }
    let markdown = prepared.markdown;
    for (const item of downloads) {
      const target = relative(
        notePath.split("/").slice(0, -1).join("/"),
        item.path,
      )
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      markdown = replaceMarkdownMediaUrl(markdown, item.media.url, target);
      if (item.write) {
        // 规划后若外部创建同名文件，保留它而不是用媒体覆盖。
        if (await read(root, item.path)) throw new LocalConflictError();
        await write(root, item.path, item.blob);
      }
      manifest.media[item.media.id] = { path: item.path, digest: item.digest };
    }
    // 下载期间本地可能又编辑：在正文提交前复核，不依赖最初的确认永久授权覆盖。
    const current = await read(root, notePath);
    if ((current ? await digest(current) : null) !== initialDigest)
      throw new LocalConflictError();
    await write(root, notePath, markdown);
    manifest.articles[prepared.articleId] = {
      path: notePath,
      digest: await digest(new Blob([markdown])),
    };
    await write(root, defaults.manifestName, JSON.stringify(manifest, null, 2));
    return { notePath };
  } finally {
    locks.delete(root);
  }
}
