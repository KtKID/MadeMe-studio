/**
 * 位图转码核心：解码 → 等比缩小（Lanczos3，从不放大）→ 按 EXIF 方向转正 → WebP 编码。
 * 不直接导入 WASM：Worker（image-wasm.ts）与本机迁移脚本（scripts/lib/node-codec.ts）各自注入
 * Photon/jSquash 实例，保证上传落库、展示衍生和存量迁移使用同一套算法与参数。
 * 重新编码只写像素，EXIF/XMP/ICC 等元数据全部不带入输出。
 */
import {
  scaledSize,
  type PixelLimits,
  WORKER_PIXEL_LIMITS,
} from "../../modules/image-delivery/contracts";

type PhotonImageLike = {
  get_width(): number;
  get_height(): number;
  get_raw_pixels(): Uint8Array;
  free(): void;
};
export type RasterLib = {
  decode(bytes: Uint8Array): PhotonImageLike;
  resize(
    image: PhotonImageLike,
    width: number,
    height: number,
  ): PhotonImageLike;
  encodeWebp(
    pixels: Uint8Array,
    width: number,
    height: number,
    quality: number,
  ): Uint8Array | null | undefined;
};
export type RasterInfo = {
  width: number;
  height: number;
  /** EXIF Orientation 1–8；没有 EXIF 时为 1。 */
  orientation: number;
  /** 源文件带 ICC 配置；输出不保留，按 sRGB 解释（广色域图可能轻微偏色）。 */
  icc: boolean;
};
export type EncodedVariant = {
  target: number;
  width: number;
  height: number;
  data: Uint8Array;
};
const swapsAxes = (orientation: number) => orientation >= 5 && orientation <= 8;

/** 在 RGBA 像素上精确执行 EXIF 方向变换（只做翻转/90° 旋转，不插值）。 */
export function orientPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  orientation: number,
) {
  if (orientation <= 1 || orientation > 8) return { pixels, width, height };
  const swap = swapsAxes(orientation);
  const outWidth = swap ? height : width;
  const outHeight = swap ? width : height;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++)
    for (let x = 0; x < outWidth; x++) {
      let sx: number, sy: number;
      switch (orientation) {
        case 2:
          sx = width - 1 - x;
          sy = y;
          break;
        case 3:
          sx = width - 1 - x;
          sy = height - 1 - y;
          break;
        case 4:
          sx = x;
          sy = height - 1 - y;
          break;
        case 5:
          sx = y;
          sy = x;
          break;
        case 6:
          sx = y;
          sy = height - 1 - x;
          break;
        case 7:
          sx = width - 1 - y;
          sy = height - 1 - x;
          break;
        default:
          sx = width - 1 - y;
          sy = x;
          break; // 8
      }
      const from = (sy * width + sx) * 4;
      out.set(pixels.subarray(from, from + 4), (y * outWidth + x) * 4);
    }
  return { pixels: out, width: outWidth, height: outHeight };
}

/** 同步执行；调用方负责串行（共享 WASM 内存）。targets 指转正后的目标宽度。 */
export function transcodeRaster(
  lib: RasterLib,
  bytes: Uint8Array,
  info: RasterInfo,
  targets: readonly number[],
  quality: number,
  limits: PixelLimits = WORKER_PIXEL_LIMITS,
): EncodedVariant[] {
  const original = lib.decode(bytes);
  try {
    if (
      original.get_width() !== info.width ||
      original.get_height() !== info.height
    )
      throw new Error("解码尺寸与文件头不一致");
    const swap = swapsAxes(info.orientation);
    const variants: EncodedVariant[] = [];
    for (const target of targets) {
      // 目标宽度按“转正后”的宽度计算；旋转 90° 的图先按交换后的边缩放。
      const oriented = scaledSize(
        swap ? info.height : info.width,
        swap ? info.width : info.height,
        target,
        limits,
      );
      const resized = lib.resize(
        original,
        swap ? oriented.height : oriented.width,
        swap ? oriented.width : oriented.height,
      );
      try {
        const turned = orientPixels(
          resized.get_raw_pixels(),
          resized.get_width(),
          resized.get_height(),
          info.orientation,
        );
        const output = lib.encodeWebp(
          turned.pixels,
          turned.width,
          turned.height,
          quality,
        );
        if (!output?.length) throw new Error("WebP 编码失败");
        // 复制出 WASM 堆，后续编码会复用同一段内存。
        variants.push({
          target,
          width: turned.width,
          height: turned.height,
          data: new Uint8Array(output),
        });
      } finally {
        resized.free();
      }
    }
    return variants;
  } finally {
    original.free();
  }
}
