import { realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { relative, isAbsolute, sep } from "node:path";
import { HarnessError } from "./errors";
export type Artifact = {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg" | "image/webp";
};
const MAX = 20 * 1024 * 1024;
function check(bytes: Uint8Array): Artifact {
  if (!bytes.length || bytes.length > MAX)
    throw new HarnessError("INVALID_IMAGE", "生成图片大小无效。", 502);
  let mime: Artifact["mime"];
  if (
    bytes.length >= 24 &&
    Buffer.from(bytes.slice(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    mime = "image/png";
  else if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    mime = "image/jpeg";
  else if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString() === "WEBP"
  )
    mime = "image/webp";
  else
    throw new HarnessError(
      "INVALID_IMAGE",
      "未取得支持的 PNG、JPEG 或 WebP 图片。",
      502,
    );
  return { bytes, mime };
}
/** 只接收本任务输出目录内的普通文件，或严格内联图片。fileId 不等于下载地址。 */
export async function readGeneratedArtifact(
  item: Record<string, unknown>,
  root: string,
): Promise<Artifact> {
  if (item.status !== "completed" || item.failure)
    throw new HarnessError(
      "IMAGE_GENERATION_FAILED",
      "Codex 生图未成功。",
      502,
    );
  if (typeof item.savedPath === "string") {
    const realRoot = await realpath(root);
    const path = await realpath(item.savedPath);
    const rel = relative(realRoot, path);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      throw new HarnessError(
        "UNSAFE_ARTIFACT",
        "图片不在本任务输出目录中。",
        502,
      );
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX)
        throw new HarnessError("INVALID_IMAGE", "生成图片文件无效。", 502);
      // 打开后再次核对路径；读取始终使用同一文件句柄，不跟随被替换的链接。
      if (
        (await realpath(path)) !== path ||
        (await realpath(root)) !== realRoot
      )
        throw new HarnessError(
          "UNSAFE_ARTIFACT",
          "图片路径在读取前发生变化。",
          502,
        );
      const bytes = Buffer.alloc(MAX + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await handle.read(
          bytes,
          size,
          bytes.length - size,
          null,
        );
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size > MAX)
        throw new HarnessError("INVALID_IMAGE", "生成图片大小超限。", 502);
      return check(new Uint8Array(bytes.subarray(0, size)));
    } finally {
      await handle.close();
    }
  }
  if (typeof item.fileId === "string")
    throw new HarnessError(
      "UNSUPPORTED_ARTIFACT",
      "当前 Codex 仅返回文件标识，尚不支持安全下载此结果。",
      502,
    );
  const raw = item.result;
  if (typeof raw !== "string" || raw.length > MAX * 1.4)
    throw new HarnessError("INVALID_IMAGE", "生成图片结果无效。", 502);
  const base64 = raw.replace(/^data:image\/(?:png|jpeg|webp);base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0)
    throw new HarnessError("INVALID_IMAGE", "生成图片编码无效。", 502);
  return check(new Uint8Array(Buffer.from(base64, "base64")));
}
