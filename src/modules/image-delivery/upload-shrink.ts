/**
 * 浏览器端上传预缩小：只处理超出 Worker 安全解码上限的静态位图。
 *
 * Worker 内存只有 128MB，服务端只能安全解码 ≤400 万像素/单边 8192/16MiB 的图片
 * （实测 12MP JPEG 解码+缩放 RSS≈285MB）。手机原图常超过这个范围，若直接上传会得到
 * 413 IMAGE_TOO_LARGE；因此 UI 上传、裁剪另存先在浏览器里按 EXIF 方向转正并缩到落库宽度，
 * 以无损 PNG 交给服务端，由服务端做唯一一次 WebP 有损编码。API/CLI 不经过这里，超限照常 413。
 * 限制内的文件原样上传，由服务端 Lanczos3 缩放，画质更稳定。
 */
import {
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_SIDE,
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_STORE_MAX_WIDTH,
} from "../config/limits";
import { clientLog } from "../log/client";

const SHRINKABLE = ["image/png", "image/jpeg", "image/webp"];

/** 是否需要在浏览器先缩小（与服务端 inspectRaster 的拒绝条件一致）。 */
export function needsBrowserShrink(
  width: number,
  height: number,
  bytes: number,
) {
  return (
    width * height > IMAGE_MAX_PIXELS ||
    Math.max(width, height) > IMAGE_MAX_SIDE ||
    bytes > IMAGE_MAX_SOURCE_BYTES
  );
}

/** 预缩小后的目标尺寸：宽度不超过落库宽度，等比，从不放大。 */
export function browserShrinkSize(width: number, height: number) {
  const scale = Math.min(1, IMAGE_STORE_MAX_WIDTH / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 是否可能需要预缩小（同步判断）；为 false 时调用方不必 await，保持上传同步启动。 */
export function mayNeedShrink(file: File) {
  return (
    SHRINKABLE.includes(file.type) && typeof createImageBitmap === "function"
  );
}

/**
 * 返回可以直接上传的文件。缩小失败时记录日志并返回原文件，由服务端给出明确拒绝原因，
 * 不吞掉错误也不伪造成功。动画 PNG/WebP 若超限会被取首帧，这是已记录的取舍。
 */
export async function shrinkForUpload(file: File): Promise<File> {
  if (!mayNeedShrink(file)) return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (!needsBrowserShrink(bitmap.width, bitmap.height, file.size))
      return file;
    const size = browserShrinkSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 2D 画布");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("无法导出缩小后的图片"))),
        "image/png",
      ),
    );
    clientLog("info", "media.upload_shrunk", {
      mime: file.type,
      size: file.size,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      width: size.width,
      height: size.height,
      shrunkSize: blob.size,
    });
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", {
      type: "image/png",
    });
  } catch (error) {
    clientLog("warn", "media.upload_shrink_failed", {
      mime: file.type,
      size: file.size,
      error,
    });
    return file;
  } finally {
    bitmap?.close();
  }
}
