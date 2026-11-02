import type {
  DirectoryHandle,
  LocalFileHandle,
  PresetRecord,
} from "../obsidian-local/contracts";
import { verifyVault } from "../obsidian-local/presets";
import {
  HARD_MAX_UPLOAD_BYTES,
  MAX_PRESET_IMPORT_ENTRIES,
} from "../config/limits";
import { throwIfAborted } from "../../shared/request-cancellation";
import {
  attachmentFile,
  isHostedMedia,
  mediaReferences,
  referencePaths,
  type Attachment,
  type ResolveOptions,
} from "./attachments";

export class PresetReadPermissionError extends Error {
  constructor(readonly state: PermissionState) {
    super(
      state === "denied"
        ? "此笔记预设的读取权限被拒绝。请重新授权此预设；不会请求写入权限。"
        : "此笔记预设需要重新授权读取，原文尚未改变。",
    );
    this.name = "PresetReadPermissionError";
  }
}
export type PresetImportSource = {
  name: string;
  documentPath: string;
  assets: Attachment[];
  resolve: ResolveOptions;
  readAttachment: (asset: Attachment) => Promise<File>;
};
export type MarkdownImportTicket = { request: number; sequence: number };
export type PresetMarkdown = {
  file: File;
  markdown: string;
  preset: PresetImportSource;
};

export function supportsPresetFilePicker() {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showOpenFilePicker?: unknown })
      .showOpenFilePicker === "function"
  );
}
/** 点击已明确的预设后才打开文章选择器，不从list[0]猜测用户仓库。 */
export function pickPresetMarkdown(
  record: PresetRecord,
): Promise<LocalFileHandle[]> {
  const picker = (
    window as unknown as {
      showOpenFilePicker?: (options: unknown) => Promise<LocalFileHandle[]>;
    }
  ).showOpenFilePicker;
  if (!picker)
    return Promise.reject(
      new Error(
        "此浏览器不支持从笔记预设选择文章，请使用支持本机文件访问的桌面浏览器。",
      ),
    );
  return picker.call(window, {
    startIn: record.handle,
    multiple: false,
    excludeAcceptAllOption: true,
    types: [
      {
        description: "Markdown",
        accept: { "text/markdown": [".md", ".markdown"] },
      },
    ],
  });
}
export async function checkPresetRead(record: PresetRecord) {
  const state =
    (await record.handle.queryPermission?.({ mode: "read" })) ?? "prompt";
  if (state !== "granted") throw new PresetReadPermissionError(state);
  if (!(await verifyVault(record.handle)))
    throw new Error(
      "这个预设已找不到 Obsidian 仓库，请到笔记预设重新关联；原文没有改变。",
    );
}
/** 仅用于用户点“重新授权此预设”的事件；不调用putPreset，不改变既有导出写权限。 */
export async function authorizePresetRead(record: PresetRecord) {
  if (!record.handle.requestPermission)
    throw new Error("浏览器无法重新授权此句柄，请到现有笔记预设重新关联。");
  const state = await record.handle.requestPermission({ mode: "read" });
  if (state !== "granted") throw new PresetReadPermissionError(state);
}

/** 从真实FileHandle确定路径，只读取选中MD和引用文件；不按文件名/正文扫描猜文章。 */
export async function readPresetMarkdown(
  record: PresetRecord,
  handle: LocalFileHandle,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<PresetMarkdown> {
  const root = record.handle;
  await checkPresetRead(record);
  if (!root.resolve)
    throw new Error("浏览器无法确认文章相对仓库的位置，请重新关联此笔记预设。");
  throwIfAborted(signal);
  const resolved = await root.resolve(handle);
  if (
    !resolved?.length ||
    resolved.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\/\u0000-\u001f]/.test(part),
    )
  )
    throw new Error(
      "所选文章不在这个笔记预设的仓库中，请选择该仓库内的 Markdown。",
    );
  const documentPath = resolved.join("/");
  if (!/\.(md|markdown)$/i.test(documentPath))
    throw new Error("请选择一篇 Markdown 文档。");
  const file = await handle.getFile();
  if (file.size > maxBytes)
    throw new Error("所选 Markdown 超过站点导入大小上限。");
  const markdown = await file.text();
  throwIfAborted(signal);
  if ((await root.resolve(handle))?.join("/") !== documentPath)
    throw new Error("读取期间文章位置已变化，请重新选择。");
  const refs = mediaReferences(markdown).filter(
    (ref) => !isHostedMedia(ref.target),
  );
  // 先验证全部路径，越根时不会开始读取任何附件。
  const candidates = refs.map((ref) => ({
    ref,
    ...referencePaths(ref, documentPath),
  }));
  let scanned = 0;
  const step = () => {
    throwIfAborted(signal);
    if (++scanned > MAX_PRESET_IMPORT_ENTRIES)
      throw new Error(
        "仓库目录过大，无法安全按裸文件名查找，请在笔记中使用明确的附件相对路径。",
      );
  };
  const missing = (error: unknown) =>
    error instanceof Error && error.name === "NotFoundError";
  async function child(
    directory: DirectoryHandle,
    name: string,
    directoryOnly: boolean,
  ): Promise<DirectoryHandle | LocalFileHandle> {
    try {
      return directoryOnly
        ? await directory.getDirectoryHandle(name, { create: false })
        : await directory.getFileHandle(name, { create: false });
    } catch (error) {
      if (!missing(error) || !directory.entries) throw error;
      // NFC/NFD仅比较目录元数据，不能因此读其它笔记正文。
      const matches: (DirectoryHandle | LocalFileHandle)[] = [];
      for await (const [entryName, entry] of directory.entries()) {
        step();
        if (
          entryName.normalize("NFC") === name.normalize("NFC") &&
          "getDirectoryHandle" in entry === directoryOnly
        )
          matches.push(entry);
      }
      if (matches.length > 1)
        throw new Error("目录包含规范化后同名的文件，请明确附件路径。");
      if (!matches.length) throw error;
      return matches[0];
    }
  }
  async function fileAt(path: string): Promise<LocalFileHandle | null> {
    const parts = path.split("/");
    let directory = root;
    try {
      for (const part of parts.slice(0, -1))
        directory = (await child(directory, part, true)) as DirectoryHandle;
      return (await child(directory, parts.at(-1)!, false)) as LocalFileHandle;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  const byPath = new Map<string, LocalFileHandle>();
  const fallback = new Set<string>();
  for (const candidate of candidates) {
    let found = false;
    for (const path of candidate.paths) {
      const result = await fileAt(path);
      if (result) {
        byPath.set(path, result);
        found = true;
      }
    }
    if (!found && candidate.basename) fallback.add(candidate.basename);
  }
  if (fallback.size) {
    const pending = [{ directory: root, path: "" }];
    while (pending.length) {
      const current = pending.pop()!;
      if (!current.directory.entries)
        throw new Error(
          "浏览器无法查找裸文件名附件，请在笔记中填写完整相对路径。",
        );
      for await (const [name, entry] of current.directory.entries()) {
        step();
        const path = current.path ? current.path + "/" + name : name;
        if ("getDirectoryHandle" in entry)
          pending.push({ directory: entry, path });
        else if (fallback.has(name.normalize("NFC")))
          byPath.set(path.normalize("NFC"), entry);
      }
    }
  }
  // 与现有attachmentPlan同样拒绝歧义；缺失项留给清单明确展示，不能改为补选完成正常路径。
  const used = new Map<string, LocalFileHandle>();
  for (const candidate of candidates) {
    const exact = candidate.paths.filter((path) => byPath.has(path));
    const paths = exact.length
      ? exact
      : candidate.basename
        ? [...byPath.keys()].filter(
            (path) => path.split("/").at(-1) === candidate.basename,
          )
        : [];
    if (paths.length > 1)
      throw new Error(
        `附件同名或路径有歧义：${candidate.ref.target}，请在笔记中使用明确相对路径。`,
      );
    if (paths[0]) used.set(paths[0], byPath.get(paths[0])!);
  }
  async function snapshot(path: string, item: LocalFileHandle) {
    throwIfAborted(signal);
    if (
      (await root.resolve!(item))
        ?.map((part) => part.normalize("NFC"))
        .join("/") !== path.normalize("NFC")
    )
      throw new Error("附件位置已变化或越出仓库，请重新选择文章。");
    const value = await item.getFile();
    if (
      (await root.resolve!(item))
        ?.map((part) => part.normalize("NFC"))
        .join("/") !== path.normalize("NFC")
    )
      throw new Error("附件读取期间位置已变化，请重新选择文章。");
    if (value.size > HARD_MAX_UPLOAD_BYTES)
      throw new Error(`附件超过上传硬上限：${value.name}`);
    attachmentFile(value);
    throwIfAborted(signal);
    return value;
  }
  const assets: Attachment[] = [];
  for (const [path, item] of used)
    assets.push({ path, file: await snapshot(path, item) });
  return {
    file,
    markdown,
    preset: {
      name: record.preset.name,
      documentPath,
      assets,
      resolve: { mode: "root", documentPath },
      readAttachment: async (asset) => {
        await checkPresetRead(record);
        const item = used.get(asset.path);
        if (!item) throw new Error("附件计划已失效，请重新选择文章。");
        const current = await snapshot(asset.path, item);
        if (
          current.size !== asset.file.size ||
          current.lastModified !== asset.file.lastModified
        )
          throw new Error(`附件已修改，请重新选择文章：${asset.file.name}`);
        return current;
      },
    },
  };
}
