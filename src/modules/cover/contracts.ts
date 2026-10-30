import { z } from "zod";

/** 封面比例预设：原图比例不加框；其余按固定宽高比展示。 */
export const COVER_ASPECTS = ["original", "1:1", "4:3", "16:9"] as const;
export type CoverAspect = (typeof COVER_ASPECTS)[number];
/** contain = 完整显示（白底补足比例）；cover = 铺满裁切（可调位置与缩放）。 */
export const COVER_FITS = ["contain", "cover"] as const;
export type CoverFit = (typeof COVER_FITS)[number];

export const COVER_ASPECT_LABELS: Record<CoverAspect, string> = {
  original: "原图比例",
  "1:1": "正方形 1:1",
  "4:3": "标准横版 4:3",
  "16:9": "宽屏 16:9",
};
export const COVER_FIT_LABELS: Record<CoverFit, string> = {
  contain: "完整显示",
  cover: "铺满裁切",
};
/** 封面最大展示宽、高（CSS 像素）；更小的容器内等比缩小。 */
export const COVER_MAX_SIZE = 1024;
/** 原图与所选比例不一致时的补边颜色。 */
export const COVER_FILL = "#ffffff";
export const COVER_ZOOM = { min: 1, max: 3, step: 0.05 } as const;

export const coverSettingsSchema = z
  .object({
    aspect: z.enum(COVER_ASPECTS),
    fit: z.enum(COVER_FITS),
    /** 裁切位置：原图剩余空间的百分比，与媒体库 cropGeometry 语义一致。 */
    focusX: z.number().min(0).max(100),
    focusY: z.number().min(0).max(100),
    zoom: z.number().min(COVER_ZOOM.min).max(COVER_ZOOM.max),
  })
  .strict();
export type CoverSettings = z.infer<typeof coverSettingsSchema>;

/** 唯一默认值：新文章与没有 coverSettings 的旧文章都使用它。 */
export const DEFAULT_COVER_SETTINGS: Readonly<CoverSettings> = Object.freeze({
  aspect: "original",
  fit: "contain",
  focusX: 50,
  focusY: 50,
  zoom: 1,
});

/** 缺失或损坏的设置逐项回退到默认值，绝不抛错影响阅读。 */
export function normalizeCoverSettings(value: unknown): CoverSettings {
  const result: CoverSettings = { ...DEFAULT_COVER_SETTINGS };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  const shape = coverSettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof CoverSettings)[]) {
    const parsed = shape[key].safeParse((value as Record<string, unknown>)[key]);
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data;
  }
  return result;
}

/** 更换封面图：保留比例与展示方式，位置与缩放回到居中原尺寸。 */
export function resetCoverFraming(value: unknown): CoverSettings {
  const s = normalizeCoverSettings(value);
  return {
    ...s,
    focusX: DEFAULT_COVER_SETTINGS.focusX,
    focusY: DEFAULT_COVER_SETTINGS.focusY,
    zoom: DEFAULT_COVER_SETTINGS.zoom,
  };
}
