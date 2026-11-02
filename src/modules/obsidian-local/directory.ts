import { obsidianDirectoryPathSchema, type DirectoryHandle } from "./contracts";

type DirectoryPicker = (options: {
  mode: "read";
  startIn: "documents" | DirectoryHandle;
}) => Promise<DirectoryHandle>;
function directoryPicker(): DirectoryPicker | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { showDirectoryPicker?: DirectoryPicker })
        .showDirectoryPicker;
}
export function isDirectoryPickerSupported(): boolean {
  return typeof directoryPicker() === "function";
}
/** 必须由点击事件直接调用；取消和授权拒绝保留原异常，调用方停止本轮操作。 */
export async function pickDirectory(
  startIn: "documents" | DirectoryHandle = "documents",
): Promise<DirectoryHandle> {
  const picker = directoryPicker();
  if (!picker)
    throw new Error(
      "此浏览器不支持本机目录授权，请使用支持的浏览器，或选择普通下载。",
    );
  // 配置预设和定位目录只需读取；写入授权留到用户实际保存文章时。
  return picker.call(window, { mode: "read", startIn });
}
export async function verifyVault(handle: DirectoryHandle): Promise<boolean> {
  const checked = obsidianDirectoryPathSchema.safeParse(handle.name);
  if (!checked.success) throw new Error(checked.error.issues[0].message);
  try {
    await handle.getDirectoryHandle(".obsidian", { create: false });
    return true;
  } catch (error) {
    // 缺少 .obsidian 是正常的普通文件夹判定；权限等故障不能伪装成普通文件夹。
    if (error instanceof Error && error.name === "NotFoundError") return false;
    throw error;
  }
}
