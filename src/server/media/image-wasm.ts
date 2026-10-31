import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon/workerd";
import factory from "@jsquash/webp/codec/enc/webp_enc.js";
import wasm from "@jsquash/webp/codec/enc/webp_enc.wasm?module";
import { defaultOptions } from "@jsquash/webp/meta.js";
import type { PixelLimits } from "../../modules/image-delivery/contracts";
import {
  transcodeRaster,
  type RasterInfo,
  type RasterLib,
} from "./raster-codec";

// 明确传入部署期编译的 WASM Module；不在 Workers 运行时编译字节或探测 SIMD。
const encoder = factory({
  instantiateWasm(imports, receive) {
    const instance = new WebAssembly.Instance(wasm, imports);
    receive(instance);
    return instance.exports;
  },
});
// WASM 内存实例共享；跨请求顺序处理（上传落库与展示衍生共用此队列），避免同时分配多张大图。
let tail: Promise<unknown> = Promise.resolve();
export function encodeRasterVariants(
  bytes: Uint8Array,
  info: RasterInfo,
  widths: readonly number[],
  quality: number,
  limits?: PixelLimits,
) {
  const run = tail.then(async () => {
    const codec = await encoder;
    const lib: RasterLib = {
      decode: (input) => PhotonImage.new_from_byteslice(input),
      resize: (image, width, height) =>
        resize(image as PhotonImage, width, height, SamplingFilter.Lanczos3),
      encodeWebp: (pixels, width, height, q) =>
        codec.encode(pixels, width, height, {
          ...defaultOptions,
          quality: q,
          alpha_quality: 100,
        }),
    };
    return transcodeRaster(lib, bytes, info, widths, quality, limits);
  });
  // 只释放队列；原请求仍收到失败，由调用边界记录并返回非成功状态。
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
