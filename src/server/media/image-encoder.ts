import {
  IMAGE_WIDTHS,
  IMAGE_QUALITY,
  IMAGE_STORE_MAX_WIDTH,
  IMAGE_STORE_QUALITY,
  WORKER_PIXEL_LIMITS,
  scaledSize,
  type PixelLimits,
} from "../../modules/image-delivery/contracts";
import { AppError } from "../errors";
import type { RasterInfo } from "./raster-codec";

/** 上传时会转成 WebP 落库的静态位图类型；GIF/AVIF/音视频/文档保持原样。 */
export const STORE_CONVERTIBLE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** 读 TIFF（EXIF 主体）IFD0 中的 Orientation（0x0112）；格式异常时按 1 处理。 */
export function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
const stripExifPrefix = (data: Uint8Array) =>
  data.length >= 6 &&
  String.fromCharCode(...data.subarray(0, 4)) === "Exif" &&
  data[4] === 0 &&
  data[5] === 0
    ? data.subarray(6)
    : data;

/**
 * 只读格式头，先限制解码内存；GIF/AVIF/动画不降成静态帧（IMAGE_PASSTHROUGH）。
 * 超过像素/单边上限抛 IMAGE_TOO_LARGE：展示衍生回退原图，上传落库则拒绝并提示先缩小。
 * EXIF 方向与 ICC 只做识别，转码时方向被应用、元数据不保留。
 */
export function inspectRaster(
  bytes: Uint8Array,
  mime: string,
  limits: PixelLimits = WORKER_PIXEL_LIMITS,
): RasterInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    orientation = 1,
    icc = false;
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
      const type = text(offset + 4, 4);
      if (type === "acTL")
        throw new AppError(415, "IMAGE_PASSTHROUGH", "动画 PNG 保留原图。");
      if (length > bytes.length - offset - 12) break;
      if (type === "iCCP") icc = true;
      if (type === "eXIf")
        orientation = exifOrientation(
          bytes.subarray(offset + 8, offset + 8 + length),
        );
      offset += length + 12;
    }
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker === 0xe1 && text(offset + 2, 6) === "Exif\0\0")
        orientation = exifOrientation(
          bytes.subarray(offset + 8, offset + length),
        );
      if (marker === 0xe2 && text(offset + 2, 11) === "ICC_PROFILE") icc = true;
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
      if (bytes[20] & 0x02)
        throw new AppError(415, "IMAGE_PASSTHROUGH", "动画 WebP 保留原图。");
      icc = !!(bytes[20] & 0x20);
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
      if (chunk === "EXIF")
        orientation = exifOrientation(
          stripExifPrefix(bytes.subarray(start, start + size)),
        );
      if (frameWidth && (frameWidth !== width || frameHeight !== height))
        throw new AppError(422, "IMAGE_DIMENSIONS", "WebP 画布与帧尺寸冲突。");
      offset += 8 + size + (size % 2);
    }
  } else if ((STORE_CONVERTIBLE_MIME as readonly string[]).includes(mime))
    // 声明为静态位图却读不出文件头：拒绝，不能当作“其他格式”原样保存。
    throw new AppError(422, "IMAGE_DIMENSIONS", "图片文件头无效或不完整。");
  else
    throw new AppError(
      415,
      "IMAGE_PASSTHROUGH",
      "此格式保留原图，未生成 WebP。",
    );
  if (!width || !height)
    throw new AppError(422, "IMAGE_DIMENSIONS", "无法读取图片尺寸。");
  if (
    width > limits.maxSide ||
    height > limits.maxSide ||
    width * height > limits.maxPixels
  )
    throw new AppError(
      413,
      "IMAGE_TOO_LARGE",
      `图片 ${width}×${height} 超过服务器可安全转换的上限（${Math.floor(limits.maxPixels / 1e6)} 百万像素、单边 ${limits.maxSide}px），请先缩小后再上传。`,
    );
  try {
    scaledSize(width, height, IMAGE_STORE_MAX_WIDTH, limits);
  } catch {
    throw new AppError(422, "IMAGE_DIMENSIONS", "图片尺寸无效。");
  }
  return { width, height, orientation, icc };
}

/** 展示衍生：从当前落库对象（或尚未迁移的旧原图）生成指定宽度的 WebP。 */
export async function encodeVariants(
  bytes: Uint8Array,
  mime: string,
  widths: readonly number[] = IMAGE_WIDTHS,
) {
  const info = inspectRaster(bytes, mime);
  // 延迟加载 WASM；不使用 sharp、付费 Images 绑定或外部处理服务。
  const { encodeRasterVariants } = await import("./image-wasm");
  return encodeRasterVariants(bytes, info, widths, IMAGE_QUALITY);
}

export type StoredImage =
  | {
      kind: "converted";
      data: Uint8Array;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
      orientation: number;
      icc: boolean;
    }
  | { kind: "kept"; reason: string };

/**
 * 上传落库：静态位图缩到最大 960 宽并转 WebP；动画/不支持的格式返回 kept（原样保存）。
 * 超限、尺寸头异常和解码/编码失败一律抛出，由 saveMedia 拒绝保存，不会退回保存大原图。
 */
export async function encodeForStorage(
  bytes: Uint8Array,
  mime: string,
): Promise<StoredImage> {
  if (!(STORE_CONVERTIBLE_MIME as readonly string[]).includes(mime))
    return { kind: "kept", reason: "not-static-raster" };
  let info: RasterInfo;
  try {
    info = inspectRaster(bytes, mime);
  } catch (error) {
    if (error instanceof AppError && error.code === "IMAGE_PASSTHROUGH")
      return { kind: "kept", reason: "animated" };
    throw error;
  }
  const { encodeRasterVariants } = await import("./image-wasm");
  const [variant] = await encodeRasterVariants(
    bytes,
    info,
    [IMAGE_STORE_MAX_WIDTH],
    IMAGE_STORE_QUALITY,
  );
  return {
    kind: "converted",
    data: variant.data,
    width: variant.width,
    height: variant.height,
    sourceWidth: info.width,
    sourceHeight: info.height,
    orientation: info.orientation,
    icc: info.icc,
  };
}
