import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PhotonImage } from "@cf-wasm/photon/node";
import { fixtureEnv } from "./support";
import { captureLogs } from "./log-capture";
import { saveMedia, webpName } from "../../src/server/media/service";
import {
  exifOrientation,
  inspectRaster,
} from "../../src/server/media/image-encoder";
import { orientPixels } from "../../src/server/media/raster-codec";

let env: ReturnType<typeof fixtureEnv>;
const fixture = (name: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/${name}`));
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => {
  vi.restoreAllMocks();
  env.DB.close();
});
const row = (id: string) =>
  env.DB.prepare("SELECT * FROM media WHERE id=?")
    .bind(id)
    .first<{ object_key: string; mime: string; size: number; name: string }>();
/** 解码落库 WebP，读取实际尺寸与指定像素。 */
function decode(bytes: Uint8Array) {
  const image = PhotonImage.new_from_byteslice(bytes);
  const width = image.get_width(),
    height = image.get_height();
  const pixels = image.get_raw_pixels();
  image.free();
  const at = (x: number, y: number) =>
    Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
  return { width, height, at };
}

it("静态 PNG 落库为 WebP：R2 只有 media/<id>.webp，行的 mime/size/name 同步更新", async () => {
  const logs = captureLogs();
  const media = await saveMedia(env, fixture("wide-1200.png"), {
    name: "Wide Shot.PNG",
    mime: "image/png",
  });
  expect(media.mime).toBe("image/webp");
  expect(media.name).toBe("Wide Shot.webp");
  expect([...env.BUCKET.objects.keys()]).toEqual([`media/${media.id}.webp`]);
  const stored = env.BUCKET.objects.get(`media/${media.id}.webp`)!;
  const saved = await row(media.id);
  expect(saved).toMatchObject({
    object_key: `media/${media.id}.webp`,
    mime: "image/webp",
    size: stored.length,
  });
  // 1200×800 等比缩到 960×640，从不放大。
  expect(decode(stored)).toMatchObject({ width: 960, height: 640 });
  expect(logs.find("media.image_stored_webp")[0]).toMatchObject({
    sourceWidth: 1200,
    width: 960,
    height: 640,
  });
});
it("小图不放大；JPEG 同样转 WebP", async () => {
  const media = await saveMedia(env, fixture("valid-image.jpg"), {
    name: "small.jpg",
    mime: "image/jpeg",
  });
  const image = decode(env.BUCKET.objects.get(`media/${media.id}.webp`)!);
  expect([image.width, image.height]).toEqual([64, 32]);
});
it("应用 EXIF 方向后再去除元数据：JPEG 方向 6（顺时针 90°）", async () => {
  const media = await saveMedia(env, fixture("orientation-6.jpg"), {
    name: "phone.jpg",
    mime: "image/jpeg",
  });
  const stored = env.BUCKET.objects.get(`media/${media.id}.webp`)!;
  const image = decode(stored);
  // 原像素 64×32：左红右蓝；转正后 32×64：上红下蓝。
  expect([image.width, image.height]).toEqual([32, 64]);
  const [r1, , b1] = image.at(16, 8);
  const [r2, , b2] = image.at(16, 56);
  expect(r1).toBeGreaterThan(150);
  expect(b1).toBeLessThan(100);
  expect(b2).toBeGreaterThan(150);
  expect(r2).toBeLessThan(100);
  expect(String.fromCharCode(...stored)).not.toContain("Exif");
});
it("PNG eXIf 方向 8 与透明度：转正并保留 alpha", async () => {
  const media = await saveMedia(env, fixture("orientation-8.png"), {
    name: "alpha.png",
    mime: "image/png",
  });
  const image = decode(env.BUCKET.objects.get(`media/${media.id}.webp`)!);
  expect([image.width, image.height]).toEqual([20, 40]);
  expect(Math.abs(image.at(10, 20)[3] - 128)).toBeLessThan(8);
});
it("动画 GIF 与非图片保持原样，记录保留原因", async () => {
  const logs = captureLogs();
  const gif = fixture("animated.gif");
  const media = await saveMedia(env, gif, {
    name: "loop.gif",
    mime: "image/gif",
  });
  expect(media.mime).toBe("image/gif");
  expect(media.name).toBe("loop.gif");
  expect(env.BUCKET.objects.get(`media/${media.id}`)).toEqual(gif);
  const text = new TextEncoder().encode("hello");
  const doc = await saveMedia(env, text, { name: "a.txt", mime: "text/plain" });
  expect(env.BUCKET.objects.get(`media/${doc.id}`)).toEqual(text);
  expect(logs.find("media.image_kept_original")).toHaveLength(0);
});
it("超出 Worker 安全上限、文件头无效、解码失败：拒绝保存且不写 R2/D1，经统一日志记录", async () => {
  const logs = captureLogs();
  const huge = fixture("valid-image.png").slice();
  new DataView(huge.buffer).setUint32(16, 5000);
  new DataView(huge.buffer).setUint32(20, 5000);
  await expect(
    saveMedia(env, huge, { name: "huge.png", mime: "image/png" }),
  ).rejects.toMatchObject({ status: 413, code: "IMAGE_TOO_LARGE" });
  await expect(
    saveMedia(env, fixture("valid-image.png").slice(0, 8), {
      name: "cut.png",
      mime: "image/png",
    }),
  ).rejects.toMatchObject({ status: 422 });
  const corrupt = fixture("valid-image.png").slice();
  corrupt.fill(7, 60, corrupt.length - 12);
  await expect(
    saveMedia(env, corrupt, { name: "bad.png", mime: "image/png" }),
  ).rejects.toMatchObject({ status: 422, code: "IMAGE_CONVERT_FAILED" });
  expect(env.BUCKET.objects.size).toBe(0);
  expect(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first<{
      n: number;
    }>())!.n,
  ).toBe(0);
  expect(logs.find("media.image_rejected").length).toBe(2);
  expect(logs.find("media.image_convert_failed")[0]).toMatchObject({
    level: "error",
  });
  // 解码失败后 WASM 实例仍可继续处理下一张图。
  const ok = await saveMedia(env, fixture("valid-image.png"), {
    name: "ok.png",
    mime: "image/png",
  });
  expect(ok.mime).toBe("image/webp");
});
it("EXIF 方向解析与像素变换", () => {
  const tiff = new Uint8Array([
    0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0,
    0, 0,
  ]);
  expect(exifOrientation(tiff)).toBe(6);
  expect(exifOrientation(new Uint8Array(4))).toBe(1);
  // 2×1：A B → 方向 6 → 1×2：A 在上；方向 8 → B 在上。
  const px = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]);
  expect(Array.from(orientPixels(px, 2, 1, 6).pixels)).toEqual([
    1, 1, 1, 1, 2, 2, 2, 2,
  ]);
  expect(Array.from(orientPixels(px, 2, 1, 8).pixels)).toEqual([
    2, 2, 2, 2, 1, 1, 1, 1,
  ]);
  expect(Array.from(orientPixels(px, 2, 1, 2).pixels)).toEqual([
    2, 2, 2, 2, 1, 1, 1, 1,
  ]);
  expect(orientPixels(px, 2, 1, 6)).toMatchObject({ width: 1, height: 2 });
  // 2×2：A B / C D。方向 5（转置）→ A C / B D；方向 7（反转置）→ D B / C A。
  const quad = new Uint8Array([1, 2, 3, 4].flatMap((v) => [v, v, v, v]));
  const firstChannel = (o: { pixels: Uint8Array }) =>
    Array.from(o.pixels).filter((_, i) => i % 4 === 0);
  expect(firstChannel(orientPixels(quad, 2, 2, 5))).toEqual([1, 3, 2, 4]);
  expect(firstChannel(orientPixels(quad, 2, 2, 7))).toEqual([4, 2, 3, 1]);
  expect(firstChannel(orientPixels(quad, 2, 2, 3))).toEqual([4, 3, 2, 1]);
  expect(firstChannel(orientPixels(quad, 2, 2, 4))).toEqual([3, 4, 1, 2]);
  expect(
    inspectRaster(fixture("orientation-6.jpg"), "image/jpeg"),
  ).toMatchObject({
    width: 64,
    height: 32,
    orientation: 6,
  });
});
it("文件名改为 .webp", () => {
  expect(webpName("a.PNG")).toBe("a.webp");
  expect(webpName("photo.final.jpeg")).toBe("photo.final.webp");
  expect(webpName("noext")).toBe("noext.webp");
});
