import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon/workerd";
import factory from "@jsquash/webp/codec/enc/webp_enc.js";
import wasm from "@jsquash/webp/codec/enc/webp_enc.wasm?module";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { scaledSize } from "../../modules/image-delivery/contracts";

// 明确传入部署期编译的 WASM Module；不在 Workers 运行时编译字节或探测 SIMD。
const encoder = factory({
  instantiateWasm(imports, receive) {
    const instance = new WebAssembly.Instance(wasm, imports);
    receive(instance);
    return instance.exports;
  },
});
// WASM 内存实例共享；跨请求顺序处理，避免同时分配多张大图。
let tail: Promise<unknown> = Promise.resolve();
export function encodeRasterVariants(
  bytes: Uint8Array,
  dimensions: { width: number; height: number },
  widths: readonly number[],
  quality: number,
) {
  const run = tail.then(async () => {
    const codec = await encoder;
    const original = PhotonImage.new_from_byteslice(bytes);
    try {
      if (
        original.get_width() !== dimensions.width ||
        original.get_height() !== dimensions.height
      )
        throw new Error("解码尺寸与文件头不一致");
      const variants = [];
      for (const target of widths) {
        const size = scaledSize(dimensions.width, dimensions.height, target);
        const image = resize(
          original,
          size.width,
          size.height,
          SamplingFilter.Lanczos3,
        );
        try {
          const output = codec.encode(
            image.get_raw_pixels(),
            size.width,
            size.height,
            { ...defaultOptions, quality, alpha_quality: 100 },
          );
          if (!output?.length) throw new Error("WebP 编码失败");
          variants.push({
            target,
            ...size,
            data: new Uint8Array(output).slice(),
          });
        } finally {
          image.free();
        }
      }
      return variants;
    } finally {
      original.free();
    }
  });
  // 只释放队列；原请求仍收到失败，由调用边界记录并返回非成功状态。
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
