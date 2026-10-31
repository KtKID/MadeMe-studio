import {
  IMAGE_WIDTHS,
  IMAGE_QUALITY,
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_SIDE,
  scaledSize,
} from "../../modules/image-delivery/contracts";
import { AppError } from "../errors";

/** 只读格式头，先限制解码内存；GIF/AVIF/动画不降成静态帧。 */
export function inspectRaster(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (
    mime === "image/png" &&
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    text(1, 3) === "PNG" &&
    text(12, 4) === "IHDR"
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (["acTL", "eXIf"].includes(text(offset + 4, 4)))
        throw new AppError(
          415,
          "IMAGE_PASSTHROUGH",
          "动画或带方向信息的 PNG 保留原图。",
        );
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      // EXIF 图片继续原样读取，避免丢失方向信息后显示旋转；不谎称已优化。
      if (marker === 0xe1 && text(offset + 2, 4) === "Exif")
        throw new AppError(
          415,
          "IMAGE_PASSTHROUGH",
          "含 EXIF 方向的 JPEG 暂保留原图。",
        );
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
        if (
          width &&
          (width !== view.getUint16(offset + 5) ||
            height !== view.getUint16(offset + 3))
        )
          throw new AppError(
            422,
            "IMAGE_DIMENSIONS",
            "JPEG 包含冲突的尺寸头。",
          );
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
      }
      offset += length;
    }
  } else if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP"
  ) {
    const kind = text(12, 4);
    if (kind === "VP8X") {
      if (bytes[20] & 10)
        throw new AppError(
          415,
          "IMAGE_PASSTHROUGH",
          "动画或带 EXIF 方向信息的 WebP 保留原图。",
        );
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === "VP8 ") {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
    // 扩展画布不能掩盖实际编码帧中的超大尺寸。
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (size > bytes.length - offset - 8)
        throw new AppError(422, "IMAGE_DIMENSIONS", "WebP 数据不完整。");
      const chunk = text(offset, 4),
        start = offset + 8;
      let frameWidth = 0,
        frameHeight = 0;
      if (chunk === "VP8 " && size >= 10) {
        frameWidth = view.getUint16(start + 6, true) & 0x3fff;
        frameHeight = view.getUint16(start + 8, true) & 0x3fff;
      }
      if (chunk === "VP8L" && size >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        frameWidth = 1 + (bits & 0x3fff);
        frameHeight = 1 + ((bits >>> 14) & 0x3fff);
      }
      if (frameWidth && (frameWidth !== width || frameHeight !== height))
        throw new AppError(422, "IMAGE_DIMENSIONS", "WebP 画布与帧尺寸冲突。");
      offset += 8 + size + (size % 2);
    }
  } else
    throw new AppError(
      415,
      "IMAGE_PASSTHROUGH",
      "此格式保留原图，未生成 WebP。",
    );
  if (
    width > IMAGE_MAX_SIDE ||
    height > IMAGE_MAX_SIDE ||
    width * height > IMAGE_MAX_PIXELS
  )
    throw new AppError(
      415,
      "IMAGE_PASSTHROUGH",
      "图片超过本机安全处理尺寸，保留原图而不冒险分配解码内存。",
    );
  try {
    scaledSize(width, height, 960);
  } catch {
    throw new AppError(
      422,
      "IMAGE_DIMENSIONS",
      "图片尺寸无效或超出安全处理上限，原图仍保留。",
    );
  }
  return { width, height };
}

export async function encodeVariants(bytes: Uint8Array, mime: string) {
  const dimensions = inspectRaster(bytes, mime);
  // 延迟加载 WASM；不使用 sharp、付费 Images 绑定或外部处理服务。
  const { encodeRasterVariants } = await import("./image-wasm");
  return encodeRasterVariants(bytes, dimensions, IMAGE_WIDTHS, IMAGE_QUALITY);
}
