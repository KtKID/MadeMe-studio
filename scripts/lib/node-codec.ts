/**
 * 本机（Node）版位图编码器：与 Worker 的 src/server/media/image-wasm.ts 使用同一套
 * Photon(Lanczos3) + jSquash WebP 与同一个 transcodeRaster，只是 WASM 从磁盘加载。
 * 仅供存量迁移脚本使用；本机内存充足，因此允许 IMAGE_MIGRATION_* 的更大像素上限。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon/node";
import factory from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import {
  IMAGE_MIGRATION_MAX_PIXELS,
  IMAGE_MIGRATION_MAX_SIDE,
  IMAGE_STORE_MAX_WIDTH,
  IMAGE_STORE_QUALITY,
} from "../../src/modules/config/limits";
import {
  transcodeRaster,
  type RasterInfo,
  type RasterLib,
} from "../../src/server/media/raster-codec";

export const MIGRATION_LIMITS = {
  maxPixels: IMAGE_MIGRATION_MAX_PIXELS,
  maxSide: IMAGE_MIGRATION_MAX_SIDE,
};

const require = createRequire(import.meta.url);
const wasm = new WebAssembly.Module(
  readFileSync(require.resolve("@jsquash/webp/codec/enc/webp_enc.wasm")),
);
const encoder = factory({
  instantiateWasm(
    imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance) => void,
  ) {
    const instance = new WebAssembly.Instance(wasm, imports);
    receive(instance);
    return instance.exports;
  },
});

/** 转成落库图：最大 960 宽、quality 80、按 EXIF 转正、丢弃元数据。 */
export async function encodeStoredImageNode(
  bytes: Uint8Array,
  info: RasterInfo,
) {
  const codec = await encoder;
  const lib: RasterLib = {
    decode: (input) => PhotonImage.new_from_byteslice(input),
    resize: (image, width, height) =>
      resize(image as PhotonImage, width, height, SamplingFilter.Lanczos3),
    encodeWebp: (pixels, width, height, quality) =>
      codec.encode(pixels, width, height, {
        ...defaultOptions,
        quality,
        alpha_quality: 100,
      }),
  };
  const [variant] = transcodeRaster(
    lib,
    bytes,
    info,
    [IMAGE_STORE_MAX_WIDTH],
    IMAGE_STORE_QUALITY,
    MIGRATION_LIMITS,
  );
  return variant;
}
