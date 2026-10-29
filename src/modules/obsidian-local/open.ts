import { z } from "zod";
import { TEXT_LIMITS } from "../config/limits";

/** URI 的 file 必须相对于定位出的仓库目录，不从浏览器句柄猜绝对路径。 */
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
/** 按已定位的仓库候选构造 URI；浏览器不能验证 Obsidian 的应用登记信息。 */
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

/** 只检查已保存文章的祖先链，不遍历兄弟目录、不读正文或应用登记信息。 */
export async function resolveObsidianUri(
  root: import("./contracts").DirectoryHandle,
  notePath: string,
): Promise<string | null> {
  const parts = vaultRelativeNotePathSchema.parse(notePath).split("/");
  const ancestors = [root];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part, { create: false });
    ancestors.push(current);
  }
  // 最近的配置目录是自动定位候选；它不等于已验证应用登记或自定义 configDir。
  for (let index = ancestors.length - 1; index >= 0; index--) {
    try {
      await ancestors[index].getDirectoryHandle(".obsidian", { create: false });
      return buildObsidianUri(
        ancestors[index].name,
        parts.slice(index).join("/"),
        true,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError"))
        throw error;
    }
  }
  return null;
}
