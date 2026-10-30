import { describe, expect, it } from "vitest";
import {
  COVER_FILL,
  COVER_MAX_SIZE,
  DEFAULT_COVER_SETTINGS,
  coverSettingsSchema,
  normalizeCoverSettings,
  resetCoverFraming,
  type CoverSettings,
} from "../src/modules/cover/contracts";
import {
  coverFrameStyle,
  coverImageStyle,
  coverRatio,
  visibleRegion,
} from "../src/modules/cover/geometry";
import { cropGeometry } from "../src/components/media/crop-state";
import { editablePostSchema, postSummarySchema } from "../src/shared/contracts";

const crop = (
  aspect: CoverSettings["aspect"],
  focusX = 50,
  focusY = 50,
  zoom = 1,
): CoverSettings => ({ aspect, fit: "cover", focusX, focusY, zoom });

describe("封面设置协议", () => {
  it("默认值集中在一个常量：原图比例 + 完整显示，居中、不缩放", () => {
    expect(DEFAULT_COVER_SETTINGS).toEqual({
      aspect: "original",
      fit: "contain",
      focusX: 50,
      focusY: 50,
      zoom: 1,
    });
    expect(Object.isFrozen(DEFAULT_COVER_SETTINGS)).toBe(true);
  });
  it("最大展示 1024×1024，补边为白色", () => {
    expect(COVER_MAX_SIZE).toBe(1024);
    expect(COVER_FILL).toBe("#ffffff");
  });
  it("只接受四种比例、两种展示方式与合法范围，拒绝未知字段", () => {
    for (const aspect of ["original", "1:1", "4:3", "16:9"] as const)
      expect(coverSettingsSchema.safeParse(crop(aspect)).success).toBe(true);
    expect(coverSettingsSchema.safeParse(crop("3:4" as never)).success).toBe(
      false,
    );
    expect(
      coverSettingsSchema.safeParse({ ...crop("1:1"), fit: "stretch" }).success,
    ).toBe(false);
    expect(coverSettingsSchema.safeParse(crop("1:1", 101)).success).toBe(false);
    expect(coverSettingsSchema.safeParse(crop("1:1", 50, -1)).success).toBe(
      false,
    );
    expect(
      coverSettingsSchema.safeParse(crop("1:1", 50, 50, 0.9)).success,
    ).toBe(false);
    expect(
      coverSettingsSchema.safeParse(crop("1:1", 50, 50, 3.1)).success,
    ).toBe(false);
    expect(
      coverSettingsSchema.safeParse({ ...crop("1:1"), extra: 1 }).success,
    ).toBe(false);
  });
  it("旧文章缺字段或数据损坏时归一到默认值，合法字段逐项保留", () => {
    expect(normalizeCoverSettings(undefined)).toEqual(DEFAULT_COVER_SETTINGS);
    expect(normalizeCoverSettings(null)).toEqual(DEFAULT_COVER_SETTINGS);
    expect(normalizeCoverSettings("16:9")).toEqual(DEFAULT_COVER_SETTINGS);
    expect(normalizeCoverSettings({ aspect: "16:9", zoom: 9 })).toEqual({
      ...DEFAULT_COVER_SETTINGS,
      aspect: "16:9",
    });
    expect(normalizeCoverSettings(crop("4:3", 10, 90, 2))).toEqual(
      crop("4:3", 10, 90, 2),
    );
  });
  it("更换封面图只重置位置与缩放，保留比例与展示方式", () => {
    expect(resetCoverFraming(crop("16:9", 0, 100, 2.5))).toEqual(crop("16:9"));
  });
  it("文章契约可选携带 coverSettings；工作台摘要不会剥离它", () => {
    const base = {
      title: "t",
      slug: "t",
      excerpt: "",
      blocks: [],
      category: "",
      tags: [],
      coverImage: "/api/files/abc",
      visibility: "draft" as const,
      pinned: false,
    };
    expect(editablePostSchema.parse(base)).not.toHaveProperty("coverSettings");
    expect(
      editablePostSchema.parse({ ...base, coverSettings: crop("1:1") })
        .coverSettings,
    ).toEqual(crop("1:1"));
    expect(
      editablePostSchema.safeParse({
        ...base,
        coverSettings: { aspect: "9:16" },
      }).success,
    ).toBe(false);
    const summary = postSummarySchema.parse({
      ...base,
      coverSettings: crop("4:3"),
      id: "x",
      version: 1,
      publishedAt: null,
      updatedAt: "2026-10-30T00:00:00Z",
      deletedAt: null,
    });
    expect(summary.coverSettings).toEqual(crop("4:3"));
  });
});

describe("封面几何：一处计算，处处一致", () => {
  it("比例预设映射为数值，原图比例无固定框", () => {
    expect(coverRatio("original")).toBeNull();
    expect(coverRatio("1:1")).toBe(1);
    expect(coverRatio("4:3")).toBeCloseTo(4 / 3);
    expect(coverRatio("16:9")).toBeCloseTo(16 / 9);
    expect(coverFrameStyle(DEFAULT_COVER_SETTINGS)).toEqual({});
    expect(coverFrameStyle(crop("16:9"))).toEqual({
      "--cover-ratio": "1.777778",
    });
  });
  it("完整显示只用 contain，不平移、不缩放（白底补边，不拉伸）", () => {
    for (const aspect of ["original", "1:1", "4:3", "16:9"] as const)
      expect(
        coverImageStyle({ ...crop(aspect, 0, 100, 3), fit: "contain" }),
      ).toEqual({ objectFit: "contain", objectPosition: "50% 50%" });
  });
  it("原图比例即使误存为铺满裁切也不裁切", () => {
    expect(coverImageStyle(crop("original", 0, 0, 2))).toEqual({
      objectFit: "contain",
      objectPosition: "50% 50%",
    });
    expect(visibleRegion(1600, 900, crop("original", 0, 0, 2))).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
  it("铺满裁切用相对单位定位与缩放，任何容器尺寸保留区域相同", () => {
    expect(coverImageStyle(crop("1:1", 20, 80, 1.5))).toEqual({
      objectFit: "cover",
      objectPosition: "20% 80%",
      transform: "scale(1.5)",
      transformOrigin: "20% 80%",
    });
    expect(coverImageStyle(crop("1:1"))).toEqual({
      objectFit: "cover",
      objectPosition: "50% 50%",
    });
  });
  it("保留区域与媒体库裁剪 cropGeometry 完全一致", () => {
    const cases: [number, number, CoverSettings][] = [
      [1600, 900, crop("1:1", 0, 50, 1)],
      [1600, 900, crop("1:1", 100, 50, 2)],
      [900, 1600, crop("16:9", 50, 0, 1)],
      [900, 1600, crop("16:9", 30, 70, 2.5)],
      [1000, 1000, crop("4:3", 50, 50, 1.25)],
    ];
    for (const [w, h, s] of cases) {
      const g = cropGeometry(
        w,
        h,
        coverRatio(s.aspect)!,
        s.zoom,
        s.focusX,
        s.focusY,
      );
      const r = visibleRegion(w, h, s);
      expect(r.x * w).toBeCloseTo(g.sx, 6);
      expect(r.y * h).toBeCloseTo(g.sy, 6);
      expect(r.width * w).toBeCloseTo(g.sw, 6);
      expect(r.height * h).toBeCloseTo(g.sh, 6);
    }
  });
  it("完整显示的保留区域是整张原图", () => {
    expect(
      visibleRegion(1600, 900, { ...crop("1:1", 0, 0, 3), fit: "contain" }),
    ).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
