import { expect, it } from "vitest";
import {
  imageSources,
  scaledSize,
} from "../src/modules/image-delivery/contracts";
import { inspectRaster } from "../src/server/media/image-encoder";

it("只为本站原图生成固定版本展示URL，外部地址不代理", () => {
  expect(imageSources("/api/files/abc", true)).toEqual({
    src: "/api/images/public/v1/abc/960.webp",
    srcSet:
      "/api/images/public/v1/abc/480.webp 480w, /api/images/public/v1/abc/960.webp 960w",
    // 展示衍生失败时由 Base.astro 的全局 onError 回退到落库图本身。
    "data-fallback-src": "/api/files/abc",
  });
  expect(imageSources("/api/files/abc", false).src).toContain("/private/");
  expect(imageSources("https://example.com/a.png", true)).toEqual({
    src: "https://example.com/a.png",
  });
});
it("缩放保持原始比例、不放大，拒绝尺寸炸弹与零尺寸", () => {
  expect(scaledSize(1536, 1024, 960)).toEqual({ width: 960, height: 640 });
  expect(scaledSize(900, 1600, 480)).toEqual({ width: 480, height: 853 });
  expect(scaledSize(120, 80, 960)).toEqual({ width: 120, height: 80 });
  expect(() => scaledSize(0, 1, 960)).toThrow();
  expect(() => scaledSize(100000, 100000, 960)).toThrow();
});
it("PNG实际尺寸在解码分配前检查，异常格式不伪装为衍生成功", () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1536);
  view.setUint32(20, 1024);
  expect(inspectRaster(bytes, "image/png")).toEqual({
    width: 1536,
    height: 1024,
    orientation: 1,
    icc: false,
  });
  view.setUint32(16, 100000);
  expect(() => inspectRaster(bytes, "image/png")).toThrow();
  expect(() => inspectRaster(new Uint8Array(3), "image/jpeg")).toThrow();
});
it("浏览器预缩小只针对超出 Worker 解码上限的图片，缩到落库宽度且不放大", async () => {
  const { needsBrowserShrink, browserShrinkSize } =
    await import("../src/modules/image-delivery/upload-shrink");
  expect(needsBrowserShrink(1536, 1024, 3_000_000)).toBe(false);
  expect(needsBrowserShrink(4032, 3024, 3_000_000)).toBe(true);
  expect(needsBrowserShrink(9000, 100, 1000)).toBe(true);
  expect(needsBrowserShrink(800, 600, 17 * 1024 * 1024)).toBe(true);
  expect(browserShrinkSize(4032, 3024)).toEqual({ width: 960, height: 720 });
  // 极长图同时受单边 8192 与 400 万像素约束，缩完一定能被服务端接受。
  for (const [w, h] of [
    [500, 9000],
    [1080, 6000],
    [6000, 1000],
  ]) {
    const size = browserShrinkSize(w, h);
    expect(size.width).toBeLessThanOrEqual(960);
    expect(needsBrowserShrink(size.width, size.height, 0)).toBe(false);
  }
  expect(browserShrinkSize(500, 9000).height).toBeLessThanOrEqual(8192);
});
it("浏览器预缩小跳过动画 PNG/WebP，避免只剩首帧", async () => {
  const { isAnimatedRaster } =
    await import("../src/modules/image-delivery/upload-shrink");
  const chunk = (type: string, length = 0) => [
    0,
    0,
    0,
    length,
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...new Array(length + 4).fill(0),
  ];
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const apng = new Uint8Array([
    ...sig,
    ...chunk("IHDR", 13),
    ...chunk("acTL", 8),
    ...chunk("IDAT"),
  ]);
  const png = new Uint8Array([
    ...sig,
    ...chunk("IHDR", 13),
    ...chunk("IDAT"),
    ...chunk("acTL", 8),
  ]);
  expect(isAnimatedRaster(apng, "image/png")).toBe(true);
  expect(isAnimatedRaster(png, "image/png")).toBe(false);
  const webp = new Uint8Array(30);
  webp.set(Array.from("RIFF\0\0\0\0WEBPVP8X", (c) => c.charCodeAt(0)));
  webp[20] = 0x02;
  expect(isAnimatedRaster(webp, "image/webp")).toBe(true);
  webp[20] = 0;
  expect(isAnimatedRaster(webp, "image/webp")).toBe(false);
});
it("落库宽度必须等于最大展示档（960 直接返回落库对象依赖此不变量）", async () => {
  const { IMAGE_STORE_MAX_WIDTH, IMAGE_WIDTHS } =
    await import("../src/modules/config/limits");
  expect(IMAGE_STORE_MAX_WIDTH).toBe(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]);
});
