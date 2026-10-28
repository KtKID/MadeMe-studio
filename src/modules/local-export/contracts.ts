/** 本地导出协议：不含目录句柄、令牌和远端写入权限。 */
import { z } from "zod";
import { blocksSchema } from "../../shared/contracts";
import { MAX_DOCUMENT_CHARS, TEXT_LIMITS } from "../config/limits";

export const exportSnapshotSchema = z
  .object({
    articleId: z.string().min(1),
    title: z.string().max(TEXT_LIMITS.postTitle),
    markdown: z.string().max(MAX_DOCUMENT_CHARS),
    blocks: blocksSchema,
    coverUrl: z.string().max(TEXT_LIMITS.url).optional(),
  })
  .strict();
export type ExportSnapshot = z.infer<typeof exportSnapshotSchema>;

export const exportMediaSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export const preparedExportSchema = z
  .object({
    articleId: z.string().min(1),
    title: z.string(),
    markdown: z.string(),
    media: z.array(exportMediaSchema),
    warnings: z.array(z.string()),
  })
  .strict();
export type PreparedExport = z.infer<typeof preparedExportSchema>;
export type ExportMedia = z.infer<typeof exportMediaSchema>;
