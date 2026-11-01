import type { CoverSettings } from "../../modules/cover/contracts";
import { normalizeCoverSettings } from "../../modules/cover/contracts";
import { coverImageStyle } from "../../modules/cover/geometry";
import { imageSources } from "../../modules/image-delivery/contracts";

/** 首页位置决定展示比例；只复用作者焦点/缩放，不写回文章设置或改文章页。 */
export default function HomeCover({
  src,
  settings,
  publiclyVisible,
  sizes,
  loading,
}: {
  src: string;
  settings?: Partial<CoverSettings> | null;
  publiclyVisible: boolean;
  sizes: string;
  loading: "lazy" | "eager";
}) {
  const source = imageSources(src, publiclyVisible);
  const framing = normalizeCoverSettings(settings);
  return (
    <div className="home-cover" data-fit="cover">
      <img
        {...source}
        sizes={source.srcSet ? sizes : undefined}
        alt=""
        loading={loading}
        decoding="async"
        draggable={false}
        // 这里只复用 cover 的焦点/缩放样式；画框比例由首页 CSS 控制，不采用此枚举作布局。
        style={coverImageStyle({ ...framing, aspect: "16:9", fit: "cover" })}
      />
    </div>
  );
}
