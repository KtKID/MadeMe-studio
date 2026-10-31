import type { CoverAspect, CoverSettings } from "./contracts";

const RATIOS: Record<Exclude<CoverAspect, "original">, number> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
};
export function coverRatio(aspect: CoverAspect): number | null {
  return aspect === "original" ? null : RATIOS[aspect];
}
/** 原图比例不裁切：即使存成 cover 也按完整显示处理。 */
export function isCropping(s: CoverSettings) {
  return s.fit === "cover" && s.aspect !== "original";
}
const pct = (n: number) => `${+n.toFixed(4)}%`;
/** 外框只携带比例变量；最大尺寸与白底由 styles.css 统一约束。 */
export function coverFrameStyle(s: CoverSettings): Record<string, string> {
  const r = coverRatio(s.aspect);
  return r ? { "--cover-ratio": r.toFixed(6) } : {};
}
/** 全部使用相对单位：任何容器尺寸下保留区域都相同。 */
export function coverImageStyle(s: CoverSettings): {
  objectFit: "contain" | "cover";
  objectPosition: string;
  transform?: string;
  transformOrigin?: string;
} {
  if (!isCropping(s))
    return { objectFit: "contain", objectPosition: "50% 50%" };
  const position = `${pct(s.focusX)} ${pct(s.focusY)}`;
  return {
    objectFit: "cover",
    objectPosition: position,
    ...(s.zoom !== 1
      ? { transform: `scale(${+s.zoom.toFixed(4)})`, transformOrigin: position }
      : {}),
  };
}
/**
 * 原图中可见的区域（0–1 小数）。object-fit:cover + object-position + 以同一点为原点的
 * scale(zoom) 与媒体库 cropGeometry 结果一致：sw = 覆盖区/zoom，sx = (W - sw)·x%。
 */
export function visibleRegion(width: number, height: number, s: CoverSettings) {
  const r = coverRatio(s.aspect);
  if (!isCropping(s) || !r || width <= 0 || height <= 0)
    return { x: 0, y: 0, width: 1, height: 1 };
  const zoom = Math.max(1, s.zoom);
  let sw = width / zoom;
  let sh = sw / r;
  if (sh > height / zoom) {
    sh = height / zoom;
    sw = sh * r;
  }
  const clamp = (v: number) => Math.max(0, Math.min(v, 100)) / 100;
  return {
    x: ((width - sw) * clamp(s.focusX)) / width,
    y: ((height - sh) * clamp(s.focusY)) / height,
    width: sw / width,
    height: sh / height,
  };
}
