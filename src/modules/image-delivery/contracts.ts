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
} from "../config/limits";
export const IMAGE_SIZES =
  "(max-width: 680px) 100vw, (max-width: 960px) 50vw, 960px";
export const imageManifestSchema = z.object({
  recipe: z.literal(IMAGE_RECIPE),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  generation: z.string().uuid(),
  variants: z
    .array(
      z.object({
        target: z.union([
          z.literal(IMAGE_WIDTHS[0]),
          z.literal(IMAGE_WIDTHS[1]),
        ]),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().positive(),
        etag: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .length(IMAGE_WIDTHS.length),
});
export type ImageManifest = z.infer<typeof imageManifestSchema>;

export function scaledSize(width: number, height: number, target: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > IMAGE_MAX_SIDE ||
    height > IMAGE_MAX_SIDE ||
    width * height > IMAGE_MAX_PIXELS
  )
    throw new Error("图片尺寸超出安全处理上限");
  const scale = Math.min(1, target / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
/** 外部图片不做代理，不把 SSRF/外站带宽请求引入处理链。 */
export function imageSources(src: string, publiclyVisible = false) {
  const match = src.match(/^\/api\/files\/([a-zA-Z0-9-]+)$/);
  if (!match) return { src };
  const url = (width: number) =>
    `/api/images/${publiclyVisible ? "public" : "private"}/${IMAGE_RECIPE}/${match[1]}/${width}.webp`;
  return {
    src: url(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]),
    srcSet: IMAGE_WIDTHS.map((width) => `${url(width)} ${width}w`).join(", "),
  };
}
