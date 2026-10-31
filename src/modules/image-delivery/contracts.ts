import { z } from "zod";

import {
  IMAGE_RECIPE,
  IMAGE_WIDTHS,
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_SIDE,
} from "../config/limits";
export {
  IMAGE_RECIPE,
  IMAGE_WIDTHS,
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_SIDE,
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_QUALITY,
  IMAGE_BROWSER_TTL,
  IMAGE_EDGE_TTL,
  IMAGE_STORE_RECIPE,
  IMAGE_STORE_MAX_WIDTH,
  IMAGE_STORE_QUALITY,
  IMAGE_MIGRATION_MAX_PIXELS,
  IMAGE_MIGRATION_MAX_SIDE,
} from "../config/limits";
export const IMAGE_SIZES =
  "(max-width: 680px) 100vw, (max-width: 960px) 50vw, 960px";
/** 解码前的像素/单边上限；Worker 用默认值，本机迁移脚本可传入更大的上限。 */
export type PixelLimits = { maxPixels: number; maxSide: number };
export const WORKER_PIXEL_LIMITS: PixelLimits = {
  maxPixels: IMAGE_MAX_PIXELS,
  maxSide: IMAGE_MAX_SIDE,
};
const widthLiteral = z
  .number()
  .int()
  .refine((value) => (IMAGE_WIDTHS as readonly number[]).includes(value));
export const imageManifestSchema = z.object({
  recipe: z.literal(IMAGE_RECIPE),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  generation: z.string().uuid(),
  // 落库图（已是 960 WebP）只需要 480 一档；旧原图仍是 480 + 960 两档。
  variants: z
    .array(
      z.object({
        target: widthLiteral,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().positive(),
        etag: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(IMAGE_WIDTHS.length),
});
export type ImageManifest = z.infer<typeof imageManifestSchema>;

export function scaledSize(
  width: number,
  height: number,
  target: number,
  limits: PixelLimits = WORKER_PIXEL_LIMITS,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > limits.maxSide ||
    height > limits.maxSide ||
    width * height > limits.maxPixels
  )
    throw new Error("图片尺寸超出安全处理上限");
  const scale = Math.min(1, target / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
/**
 * 外部图片不做代理，不把 SSRF/外站带宽请求引入处理链。
 * data-fallback-src 指向受控原地址（现为落库的 960 WebP）：展示图加载失败时由 Base 布局的内联脚本切回。
 */
export function imageSources(src: string, publiclyVisible = false) {
  const match = src.match(/^\/api\/files\/([a-zA-Z0-9-]+)$/);
  if (!match) return { src };
  const url = (width: number) =>
    `/api/images/${publiclyVisible ? "public" : "private"}/${IMAGE_RECIPE}/${match[1]}/${width}.webp`;
  return {
    src: url(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]),
    srcSet: IMAGE_WIDTHS.map((width) => `${url(width)} ${width}w`).join(", "),
    "data-fallback-src": src,
  };
}
