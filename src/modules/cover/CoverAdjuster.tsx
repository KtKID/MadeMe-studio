import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  COVER_ASPECTS,
  COVER_ASPECT_LABELS,
  COVER_FITS,
  COVER_FIT_LABELS,
  COVER_MAX_SIZE,
  COVER_ZOOM,
  normalizeCoverSettings,
  type CoverSettings,
} from "./contracts";
import { isCropping, visibleRegion } from "./geometry";
import CoverFrame from "./CoverFrame";
import "./styles.css";

const clamp = (v: number) =>
  Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
const pct = (v: number) => `${+(v * 100).toFixed(4)}%`;
const KEY_STEP = 5;

/** 比例 → 展示方式 → 位置/缩放 → 实时预览。只修改展示参数，原图不变。 */
export default function CoverAdjuster({
  src,
  value,
  onChange,
  disabled = false,
}: {
  src: string;
  value: Partial<CoverSettings> | undefined;
  onChange: (next: CoverSettings) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const s = normalizeCoverSettings(value);
  const cropping = isCropping(s);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    focusX: number;
    focusY: number;
    width: number;
    height: number;
  } | null>(null);
  const region = natural ? visibleRegion(natural.w, natural.h, s) : null;
  const set = (patch: Partial<CoverSettings>) => onChange({ ...s, ...patch });
  function move(dxFraction: number, dyFraction: number) {
    const start = drag.current!;
    if (!region) return;
    const slackX = 1 - region.width;
    const slackY = 1 - region.height;
    set({
      focusX:
        slackX > 1e-6
          ? clamp(start.focusX + (dxFraction / slackX) * 100)
          : s.focusX,
      focusY:
        slackY > 1e-6
          ? clamp(start.focusY + (dyFraction / slackY) * 100)
          : s.focusY,
    });
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || !region) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      focusX: s.focusX,
      focusY: s.focusY,
      width: rect.width,
      height: rect.height,
    };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    move(
      (e.clientX - start.x) / start.width,
      (e.clientY - start.y) / start.height,
    );
  }
  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const next: Partial<CoverSettings> | null =
      e.key === "ArrowLeft"
        ? { focusX: clamp(s.focusX - KEY_STEP) }
        : e.key === "ArrowRight"
          ? { focusX: clamp(s.focusX + KEY_STEP) }
          : e.key === "ArrowUp"
            ? { focusY: clamp(s.focusY - KEY_STEP) }
            : e.key === "ArrowDown"
              ? { focusY: clamp(s.focusY + KEY_STEP) }
              : e.key === "Home"
                ? { focusX: 0 }
                : e.key === "End"
                  ? { focusX: 100 }
                  : null;
    if (!next) return;
    e.preventDefault();
    set(next);
  }
  return (
    <div className="cover-adjuster">
      <div className="cover-adjuster-row">
        <span className="cover-adjuster-label" id={`${id}-aspect`}>
          比例
        </span>
        <div
          className="cover-segmented"
          role="radiogroup"
          aria-labelledby={`${id}-aspect`}
        >
          {COVER_ASPECTS.map((aspect) => (
            <button
              key={aspect}
              type="button"
              role="radio"
              aria-checked={s.aspect === aspect}
              aria-label={COVER_ASPECT_LABELS[aspect]}
              className={s.aspect === aspect ? "active" : ""}
              disabled={disabled}
              onClick={() => set({ aspect })}
            >
              {COVER_ASPECT_LABELS[aspect]}
            </button>
          ))}
        </div>
      </div>
      <div className="cover-adjuster-row">
        <span className="cover-adjuster-label" id={`${id}-fit`}>
          展示方式
        </span>
        <div
          className="cover-segmented"
          role="radiogroup"
          aria-labelledby={`${id}-fit`}
        >
          {COVER_FITS.map((fit) => (
            <button
              key={fit}
              type="button"
              role="radio"
              aria-checked={s.aspect !== "original" && s.fit === fit}
              aria-label={COVER_FIT_LABELS[fit]}
              className={
                s.aspect !== "original" && s.fit === fit ? "active" : ""
              }
              disabled={disabled || s.aspect === "original"}
              onClick={() => set({ fit })}
            >
              {COVER_FIT_LABELS[fit]}
            </button>
          ))}
        </div>
      </div>
      <p className="cover-adjuster-hint muted">
        {s.aspect === "original"
          ? `原图比例不裁切、不补边，按原图等比展示，最大 ${COVER_MAX_SIZE}×${COVER_MAX_SIZE}。`
          : cropping
            ? "铺满裁切：拖动高亮框或使用滑杆选择保留区域，变暗的部分不会显示。"
            : "完整显示：图片不裁切、不拉伸，空余部分用白色补足所选比例。"}
      </p>
      {cropping && (
        <>
          <div
            className="cover-crop-overview"
            tabIndex={disabled ? -1 : 0}
            aria-label="拖动或用方向键调整保留区域"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            <img
              src={src}
              alt="封面原图"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0)
                  setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
            {region && (
              <div
                data-testid="cover-kept-region"
                className="cover-kept-region"
                style={{
                  left: pct(region.x),
                  top: pct(region.y),
                  width: pct(region.width),
                  height: pct(region.height),
                }}
              />
            )}
          </div>
          <div className="form-grid cover-adjuster-sliders">
            <label>
              缩放
              <input
                type="range"
                min={COVER_ZOOM.min}
                max={COVER_ZOOM.max}
                step={COVER_ZOOM.step}
                value={s.zoom}
                disabled={disabled}
                onChange={(e) => set({ zoom: +e.target.value })}
              />
            </label>
            <label>
              水平位置
              <input
                type="range"
                min="0"
                max="100"
                value={s.focusX}
                disabled={disabled}
                onChange={(e) => set({ focusX: +e.target.value })}
              />
            </label>
            <label>
              垂直位置
              <input
                type="range"
                min="0"
                max="100"
                value={s.focusY}
                disabled={disabled}
                onChange={(e) => set({ focusY: +e.target.value })}
              />
            </label>
          </div>
        </>
      )}
      <div
        className="cover-adjuster-preview"
        role="group"
        aria-label="实时预览"
      >
        <span className="cover-adjuster-label">实时预览</span>
        <CoverFrame src={src} settings={s} alt="" />
      </div>
    </div>
  );
}
