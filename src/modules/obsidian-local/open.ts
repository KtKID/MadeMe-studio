import { z } from "zod";
import { TEXT_LIMITS } from "../config/limits";

/** URI 的 file 必须相对于所选目录，不从浏览器句柄猜绝对路径。 */
export const vaultRelativeNotePathSchema = z
  .string()
  .min(1)
  .max(TEXT_LIMITS.url)
  .refine(
    (path) =>
      !/^\//.test(path) &&
      !/[\\:\u0000-\u001f]/.test(path) &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
  );
/** 仅恢复原有 best-effort 打开入口；浏览器不能验证 Obsidian 的应用登记信息。 */
export function buildObsidianUri(
  rootName: string,
  notePath: string,
  rootHasObsidian: boolean,
): string | null {
  if (
    !rootHasObsidian ||
    !z.string().min(1).max(TEXT_LIMITS.url).safeParse(rootName).success ||
    !vaultRelativeNotePathSchema.safeParse(notePath).success
  )
    return null;
  return `obsidian://open?vault=${encodeURIComponent(rootName)}&file=${encodeURIComponent(notePath)}`;
}
