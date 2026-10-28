import { z } from "zod";
import { TEXT_LIMITS } from "../config/limits";
import { presetSchema } from "./contracts";
/** URI 的 file 必须相对于用户确认的 vault 根，不从浏览器句柄猜绝对路径。 */
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
export function buildObsidianUri(
  preset: unknown,
  notePath: string,
  rootHasObsidian: boolean,
): string | null {
  const parsed = presetSchema.safeParse(preset);
  if (
    !parsed.success ||
    !rootHasObsidian ||
    !parsed.data.isVault ||
    !parsed.data.vaultRootConfirmed ||
    !parsed.data.obsidianVault ||
    !vaultRelativeNotePathSchema.safeParse(notePath).success
  )
    return null;
  return `obsidian://open?vault=${encodeURIComponent(parsed.data.obsidianVault)}&file=${encodeURIComponent(notePath)}`;
}
