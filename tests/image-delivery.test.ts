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
  expect(browserShrinkSize(500, 9000)).toEqual({ width: 500, height: 9000 });
});
