import type { CSSProperties } from "react";
import { normalizeCoverSettings, type CoverSettings } from "./contracts";
import { coverFrameStyle, coverImageStyle, isCropping } from "./geometry";
import "./styles.css";
import { imageSources, IMAGE_SIZES } from "../image-delivery/contracts";

/**
 * 首页卡片、文章页、编辑器、工作台缩略图共用的封面展示。
 * flow：随容器宽度等比缩放，最大 1024×1024；thumb：在固定小框内整体等比缩小，不另行裁切。
 */
export default function CoverFrame({
  src,
  settings,
  alt = "",
  variant = "flow",
  loading,
  className = "",
  publiclyVisible = false,
  sizes = IMAGE_SIZES,
}: {
  src: string;
  settings?: Partial<CoverSettings> | null;
  alt?: string;
  variant?: "flow" | "thumb";
  loading?: "lazy" | "eager";
  className?: string;
  publiclyVisible?: boolean;
  sizes?: string;
}) {
  const s = normalizeCoverSettings(settings);
  return (
    <div
      className={`cover-frame cover-frame--${variant}${className ? ` ${className}` : ""}`}
      data-aspect={s.aspect}
      data-fit={isCropping(s) ? "cover" : "contain"}
      style={coverFrameStyle(s) as CSSProperties}
    >
      <img
        {...imageSources(src, publiclyVisible)}
        sizes={imageSources(src, publiclyVisible).srcSet ? sizes : undefined}
        alt={alt}
        loading={loading}
        decoding="async"
        draggable={false}
        style={coverImageStyle(s)}
      />
    </div>
  );
}
