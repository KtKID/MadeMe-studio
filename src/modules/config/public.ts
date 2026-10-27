/**
 * 前后端共用（同构）的配置工具：下发给浏览器的裁剪、上传前检查、文案生成。
 * 这里没有任何 Workers / D1 依赖，可在浏览器、Workers 与 Node 测试中运行。
 */
import { DEFAULT_CONFIG } from "./defaults.ts";
import {
  HARD_MAX_UPLOAD_MB,
  MEDIA_CATEGORY_LABELS,
  MEDIA_TYPES,
  KiB,
  MiB,
  type MediaCategory,
} from "./limits.ts";
import type { RuntimeConfig, UploadConfig } from "./schema.ts";

/**
 * 下发给浏览器的配置。作者拿到完整配置；读者只拿到阅读相关字段，其余一律是默认值，
 * 避免公开页面透露作者调过的上传、限流、会话等运营参数。
 */
export function toClientConfig(
  config: RuntimeConfig,
  audience: "owner" | "reader",
): RuntimeConfig {
  if (audience === "owner") return structuredClone(config);
  return {
    ...structuredClone(DEFAULT_CONFIG),
    reading: {
      ...structuredClone(DEFAULT_CONFIG.reading),
      disabledEmbeds: [...config.reading.disabledEmbeds],
      xFallbackSeconds: config.reading.xFallbackSeconds,
      xInitialHeight: config.reading.xInitialHeight,
      cardTags: config.reading.cardTags,
    },
  };
}

const typeByMime = new Map<string, (typeof MEDIA_TYPES)[number]>(
  MEDIA_TYPES.map((t) => [t.mime, t]),
);
export function mediaCategory(mime: string): MediaCategory | null {
  return typeByMime.get(mime)?.category ?? null;
}
const categoryKey: Record<MediaCategory, keyof UploadConfig> = {
  image: "imageMaxMB",
  video: "videoMaxMB",
  audio: "audioMaxMB",
  document: "documentMaxMB",
};
/** 某一类文件的上限（字节）；永远不超过硬上限。 */
export function uploadLimitBytes(upload: UploadConfig, category: MediaCategory) {
  return Math.min(upload[categoryKey[category]] as number, HARD_MAX_UPLOAD_MB) * MiB;
}
/** AI 生成图片入库时的策略：不受作者上传上限与禁用类型影响，只受硬上限约束。 */
export const GENERATED_MEDIA_POLICY: UploadConfig = {
  ...DEFAULT_CONFIG.upload,
  imageMaxMB: HARD_MAX_UPLOAD_MB,
  videoMaxMB: HARD_MAX_UPLOAD_MB,
  audioMaxMB: HARD_MAX_UPLOAD_MB,
  documentMaxMB: HARD_MAX_UPLOAD_MB,
  disabledTypes: [],
};
/** 所有类别里最大的上限：服务端在解析 multipart 之前用它限制请求体。 */
export function largestUploadBytes(upload: UploadConfig) {
  return Math.max(
    ...(Object.keys(categoryKey) as MediaCategory[]).map((c) =>
      uploadLimitBytes(upload, c),
    ),
  );
}
export function formatBytes(bytes: number) {
  if (bytes >= MiB) return `${+(bytes / MiB).toFixed(1)} MB`;
  if (bytes >= KiB) return `${Math.round(bytes / KiB)} KB`;
  return `${bytes} B`;
}
/** 当前允许的 MIME 列表（白名单减去设置页关闭的类型）。 */
export function enabledMediaMimes(upload: UploadConfig): string[] {
  const disabled = new Set(upload.disabledTypes);
  return MEDIA_TYPES.map((t) => t.mime).filter((m) => !disabled.has(m));
}
/** 某类当前允许的格式文案，例如 “MP4、WebM、MOV”。 */
export function formatsLabel(upload: UploadConfig, category: MediaCategory) {
  const enabled = new Set(enabledMediaMimes(upload));
  return [
    ...new Set(
      MEDIA_TYPES.filter((t) => t.category === category && enabled.has(t.mime)).map(
        (t) => t.label,
      ),
    ),
  ].join("、");
}
/** 上传面板提示，例如 “MP4、WebM、MOV，≤ 25 MB”。 */
export function uploadHint(upload: UploadConfig, category: MediaCategory) {
  const formats = formatsLabel(upload, category);
  if (!formats) return `${MEDIA_CATEGORY_LABELS[category]}上传已在设置中关闭`;
  return `${formats}，≤ ${formatBytes(uploadLimitBytes(upload, category))}`;
}

export type UploadProblem = {
  reason: "empty" | "too_large" | "unsupported_type" | "type_disabled";
  message: string;
  status: 413 | 415;
  code: "FILE_TOO_LARGE" | "UNSUPPORTED_MEDIA" | "MEDIA_TYPE_DISABLED";
};
/**
 * 上传前检查（编辑器、媒体库、服务端 validateMedia 共用同一个函数）：
 * 大小按类别取配置值，类型取白名单减去禁用项。返回 null 表示通过。
 */
export function uploadProblem(
  file: { size: number; type: string },
  upload: UploadConfig = DEFAULT_CONFIG.upload,
): UploadProblem | null {
  const category = mediaCategory(file.type);
  if (!category)
    return {
      reason: "unsupported_type",
      status: 415,
      code: "UNSUPPORTED_MEDIA",
      message: `暂不支持该文件格式（${file.type || "未知类型"}）。视频支持 ${formatsLabel(upload, "video") || "（已关闭）"}，音频支持 ${formatsLabel(upload, "audio") || "（已关闭）"}；不接受 SVG 与 HTML。`,
    };
  if (upload.disabledTypes.includes(file.type))
    return {
      reason: "type_disabled",
      status: 415,
      code: "MEDIA_TYPE_DISABLED",
      message: `该格式（${typeByMime.get(file.type)!.label}）已在“设置 → 上传与媒体”中关闭。`,
    };
  if (file.size <= 0)
    return {
      reason: "empty",
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "文件是空的，请重新选择。",
    };
  const max = uploadLimitBytes(upload, category);
  if (file.size > max)
    return {
      reason: "too_large",
      status: 413,
      code: "FILE_TOO_LARGE",
      message: `${MEDIA_CATEGORY_LABELS[category]}文件太大（${formatBytes(file.size)}），单个文件请小于 ${formatBytes(max)}（可在“设置 → 上传与媒体”调整）。${category === "video" ? "视频也可以压缩后再上传，或改用“嵌入”插入 YouTube / Bilibili 链接。" : ""}`,
    };
  return null;
}
