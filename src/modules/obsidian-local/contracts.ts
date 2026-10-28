import { z } from "zod";
import { OBSIDIAN_LOCAL_DEFAULTS, TEXT_LIMITS } from "../config/limits";

/** 仅本机使用的目录能力；不是可序列化或上传服务器的业务凭据。 */
export interface DirectoryHandle {
  readonly name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LocalFileHandle>;
  resolve?(handle: DirectoryHandle): Promise<string[] | null>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}
export interface LocalFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Blob | string | Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

const relativePath = z
  .string()
  .max(TEXT_LIMITS.url)
  .refine(
    (value) => !/^[\/\\]|[\\:\u0000-\u001f]/.test(value),
    "请填写授权根目录内的相对路径，不支持绝对路径。",
  );
/** 路径规范化不得爬出根目录；图片规则相对于文章目录计算。 */
function containedPath(base: string, relative: string) {
  let depth = 0;
  for (const segment of `${base}/${relative}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (--depth < 0) return false;
    } else depth += 1;
  }
  return true;
}
export const presetSchema = z
  .object({
    id: z.string().trim().min(1).max(TEXT_LIMITS.url),
    name: z
      .string()
      .trim()
      .min(1, "请填写预设名称。")
      .max(TEXT_LIMITS.postTitle),
    // 目录显示名；后两项仅兼容保留历史数据，不参与UI或打开链接前置条件。
    vaultName: z.string().min(1).max(TEXT_LIMITS.url),
    obsidianVault: z.string().trim().max(TEXT_LIMITS.url).optional(),
    vaultRootConfirmed: z.boolean().optional(),
    noteDirectory: relativePath.default(OBSIDIAN_LOCAL_DEFAULTS.noteDirectory),
    imageRule: relativePath.min(1).default(OBSIDIAN_LOCAL_DEFAULTS.imageRule),
    isVault: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!containedPath("", value.noteDirectory)) {
      context.addIssue({
        code: "custom",
        path: ["noteDirectory"],
        message: "文章目录不能越过授权根目录。",
      });
    }
    if (!containedPath(value.noteDirectory, value.imageRule)) {
      context.addIssue({
        code: "custom",
        path: ["imageRule"],
        message: "图片规则不能越过授权根目录。",
      });
    }
  });
export type Preset = z.infer<typeof presetSchema>;

const directoryHandleSchema = z.custom<DirectoryHandle>((value) => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DirectoryHandle>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.getDirectoryHandle === "function" &&
    typeof candidate.getFileHandle === "function"
  );
}, "目录授权已失效，请重新浏览选择目录。");
/** IndexedDB 可结构化克隆目录句柄，绝不把它改为手填路径或 JSON。 */
export const presetRecordSchema = z
  .object({ preset: presetSchema, handle: directoryHandleSchema })
  .strict();
export type PresetRecord = z.infer<typeof presetRecordSchema>;
