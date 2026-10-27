import { clientLog } from "../log/client";
import { logger } from "../log/server";
import type { EmbedParseResult } from "./types";

/**
 * 记录一次被拒绝或无法识别的嵌入链接（info 级别）。只记录 reason、场景与主机名，
 * 绝不记录完整 URL（查询串里常带 vd_source、spm_id_from 等追踪参数）。
 * 浏览器端写控制台，服务端写结构化日志。
 */
export function reportEmbedRejection(
  where: "server_validation" | "reader" | "editor",
  result: EmbedParseResult,
  extra: Record<string, unknown> = {},
) {
  if (result.ok) return;
  const fields = {
    where,
    reason: result.reason,
    ...(result.host ? { host: result.host } : {}),
    ...extra,
  };
  if (typeof window === "undefined") logger.info("embed.rejected", fields);
  else clientLog("info", "embed.rejected", fields);
}
