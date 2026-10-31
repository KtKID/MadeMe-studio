import {
  IMAGE_RECIPE,
  IMAGE_WIDTHS,
  IMAGE_BROWSER_TTL,
  IMAGE_EDGE_TTL,
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_STORE_MAX_WIDTH,
  IMAGE_STORE_RECIPE,
  imageManifestSchema,
  type ImageManifest,
} from "../../modules/image-delivery/contracts";
import { type RuntimeEnv, type R2Bucket } from "../runtime";
import type { Identity } from "../auth/identity";
import { AppError, notFound } from "../errors";
import { log, logCaught } from "../../modules/log/server";
import { readableMedia, isStoredImage, type MediaRow } from "./service";
import { encodeVariants, inspectRaster } from "./image-encoder";

const jobs = new WeakMap<R2Bucket, Map<string, Promise<ImageManifest>>>();
// 从读取源字节起串行，不能仅串行解码而让排队请求提前把大原图全部读入内存。
let generationTail: Promise<unknown> = Promise.resolve();
function serializeGeneration<T>(generate: () => Promise<T>): Promise<T> {
  const run = generationTail.then(generate);
  generationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
/**
 * 落库图（media/<id>.webp，已是 960 WebP）的衍生放在 s1/ 子目录，只生成比落库宽度更小的档位；
 * 尚未迁移的旧原图沿用原路径与 480 + 960 两档。两套 manifest 互不复用，迁移后旧批次可整体删除。
 */
const derivativeRoot = (row: MediaRow) =>
  isStoredImage(row)
    ? `image-derivatives/${IMAGE_RECIPE}/${row.id}/${IMAGE_STORE_RECIPE}`
    : `image-derivatives/${IMAGE_RECIPE}/${row.id}`;
const derivativeWidths = (row: MediaRow): readonly number[] =>
  isStoredImage(row)
    ? IMAGE_WIDTHS.filter((width) => width < IMAGE_STORE_MAX_WIDTH)
    : IMAGE_WIDTHS;
const manifestKey = (row: MediaRow) => `${derivativeRoot(row)}/manifest.json`;
const variantKey = (
  row: MediaRow,
  hash: string,
  generation: string,
  width: number,
) => `${derivativeRoot(row)}/${hash}/${generation}/${width}.webp`;
async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
/** 按需处理：所有上传/导入/裁剪/生成/旧封面最终通过原媒体 ID 进入此处。 */
export function ensureImageVariants(bucket: R2Bucket, row: MediaRow) {
  let pending = jobs.get(bucket);
  if (!pending) {
    pending = new Map();
    jobs.set(bucket, pending);
  }
  const active = pending.get(row.id);
  if (active) return active;
  const run = (async () => {
    const stored = await bucket.get(manifestKey(row));
    if (stored)
      return imageManifestSchema.parse(
        JSON.parse(await new Response(stored.body).text()),
      );
    return serializeGeneration(async () => {
      // 排队期间其它请求可能已经完成；重新读取，避免包装不同但指向同一桶的请求重复编码。
      const completed = await bucket.get(manifestKey(row));
      if (completed)
        return imageManifestSchema.parse(
          JSON.parse(await new Response(completed.body).text()),
        );
      const source = await bucket.get(row.object_key);
      if (!source) throw notFound();
      if (source.size > IMAGE_MAX_SOURCE_BYTES) {
        await source.body.cancel();
        throw new AppError(
          415,
          "IMAGE_PASSTHROUGH",
          "原图超过安全处理体积，保留原文件。",
        );
      }
      const bytes = new Uint8Array(
        await new Response(source.body).arrayBuffer(),
      );
      const hash = await digest(bytes);
      const encoded = await encodeVariants(
        bytes,
        row.mime,
        derivativeWidths(row),
      );
      const generation = crypto.randomUUID();
      const entries: ImageManifest["variants"] = [];
      const written: string[] = [];
      let publishing = false;
      try {
        for (const variant of encoded) {
          const key = variantKey(row, hash, generation, variant.target);
          // 先登记尝试写的键，覆盖 R2 put 已完成但响应失败的情况。
          written.push(key);
          await bucket.put(key, variant.data, {
            httpMetadata: { contentType: "image/webp" },
          });
          entries.push({
            target: variant.target,
            width: variant.width,
            height: variant.height,
            bytes: variant.data.length,
            etag: await digest(variant.data),
          });
        }
        const manifest = imageManifestSchema.parse({
          recipe: IMAGE_RECIPE,
          hash,
          generation,
          variants: entries,
        });
        publishing = true;
        await bucket.put(
          manifestKey(row),
          new TextEncoder().encode(JSON.stringify(manifest)),
          { httpMetadata: { contentType: "application/json" } },
        );
        return manifest;
      } catch (error) {
        // 只回滚本轮唯一 generation 的对象，不能删除跨实例已完成的批次或共享 manifest。
        // manifest put 的异常可能是响应丢失；不可删除可能已提交的批次，下一请求先读 manifest 核对。
        for (const key of publishing ? [] : written.reverse()) {
          try {
            await bucket.delete(key);
          } catch (rollback) {
            logCaught("image.rollback_failed", rollback, { mediaId: row.id });
          }
        }
        throw error;
      }
    });
  })();
  pending.set(row.id, run);
  void run.then(
    () => pending!.delete(row.id),
    () => pending!.delete(row.id),
  );
  return run;
}

function variantHeaders(bytes: number, etag: string, processing: string) {
  return {
    "Content-Type": "image/webp",
    "Content-Length": String(bytes),
    ETag: `"${etag}"`,
    "Cache-Control": `public, max-age=${IMAGE_EDGE_TTL}`,
    "X-Image-Processing": processing,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
async function putEdgeCache(
  cache: Cache | undefined,
  key: Request,
  response: Response,
  mediaId: string,
) {
  if (!cache) return;
  try {
    await cache.put(key, response.clone());
  } catch (error) {
    logCaught("image.edge_cache_failed", error, { mediaId }, "warn");
  }
}

/** 授权始终在边缘缓存查询、ETag/HEAD 和 R2 处理之前，撤回后不可命中缓存绕过。 */
export async function serveImageVariant(
  request: Request,
  env: RuntimeEnv,
  identity: Identity,
  input: { id: string; width: number; publicOnly: boolean },
) {
  if (!IMAGE_WIDTHS.includes(input.width as 480 | 960)) throw notFound();
  const row = await readableMedia(
    request,
    env,
    identity,
    input.id,
    input.publicOnly,
  );
  const cache = input.publicOnly
    ? (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)
        ?.default
    : undefined;
  const canonical = new URL(request.url);
  canonical.search = "";
  const key = new Request(canonical, { method: "GET" });
  // 缓存项只是公开图片字节；每次请求已重新检查当前公开快照中的真实引用。
  let cached: Response | undefined;
  try {
    cached = await cache?.match(key);
  } catch (error) {
    logCaught("image.edge_cache_failed", error, { mediaId: row.id }, "warn");
  }
  let response: Response;
  if (cached) response = cached;
  else if (isStoredImage(row) && !derivativeWidths(row).includes(input.width)) {
    // 960 档就是落库对象本身，不再另存一份；读取 ≤ 数百 KB 的 WebP 计算强 ETag。
    const object = await env.BUCKET!.get(row.object_key);
    if (!object) {
      log("error", "image.stored_object_missing", { mediaId: row.id });
      throw new AppError(503, "IMAGE_VARIANT_MISSING", "图片对象缺失。");
    }
    const data = new Uint8Array(await new Response(object.body).arrayBuffer());
    const headers: Record<string, string> = variantHeaders(
      data.length,
      await digest(data),
      `${IMAGE_STORE_RECIPE}-stored`,
    );
    try {
      // 只读 WebP 文件头，与衍生分支保持相同的尺寸响应头。
      const size = inspectRaster(data, "image/webp");
      headers["X-Image-Width"] = String(size.width);
      headers["X-Image-Height"] = String(size.height);
    } catch (error) {
      logCaught(
        "image.stored_header_unreadable",
        error,
        { mediaId: row.id },
        "warn",
      );
    }
    response = new Response(data, { headers });
    await putEdgeCache(cache, key, response, row.id);
  } else {
    let manifest: ImageManifest;
    try {
      manifest = await ensureImageVariants(env.BUCKET!, row);
    } catch (error) {
      // 旧原图为动画/不支持格式/超出 Worker 安全上限时回退原图；落库图不会走到这里。
      if (
        error instanceof AppError &&
        ["IMAGE_PASSTHROUGH", "IMAGE_TOO_LARGE"].includes(error.code)
      ) {
        logCaught("image.passthrough", error, { mediaId: row.id }, "info");
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/api/files/${row.id}`,
            "Cache-Control": "private, no-store",
            "X-Image-Processing": "original-unprocessed",
          },
        });
      }
      logCaught("image.derivative_failed", error, { mediaId: row.id });
      throw error instanceof AppError
        ? error
        : new AppError(
            503,
            "IMAGE_PROCESSING_FAILED",
            "展示图处理失败；原图未更改，请重试。",
          );
    }
    const variant = manifest.variants.find((v) => v.target === input.width);
    if (!variant)
      throw new AppError(503, "IMAGE_VARIANT_MISSING", "展示图缺失，请重试。");
    const object = await env.BUCKET!.get(
      variantKey(row, manifest.hash, manifest.generation, input.width),
    );
    if (!object || object.size !== variant.bytes)
      throw new AppError(
        503,
        "IMAGE_VARIANT_MISSING",
        "展示图对象不完整；原图未更改。",
      );
    response = new Response(object.body, {
      headers: {
        ...variantHeaders(variant.bytes, variant.etag, IMAGE_RECIPE),
        "X-Image-Width": String(variant.width),
        "X-Image-Height": String(variant.height),
      },
    });
    await putEdgeCache(cache, key, response, row.id);
  }
  const headers = new Headers(response.headers);
  // s-maxage=0 不允许 CDN 在 Worker 授权之前直接复用；边缘字节缓存只经上述检查读取。
  headers.set(
    "Cache-Control",
    input.publicOnly
      ? `public, max-age=${IMAGE_BROWSER_TTL}, s-maxage=0, must-revalidate`
      : "private, no-store",
  );
  headers.delete("Set-Cookie");
  headers.delete("Vary");
  const match = request.headers
    .get("If-None-Match")
    ?.split(",")
    .map((s) => s.trim());
  const unmodified = !!match?.some(
    (value) =>
      value === "*" || value.replace(/^W\//, "") === headers.get("ETag"),
  );
  if (unmodified || request.method === "HEAD") {
    await response.body?.cancel();
    if (unmodified) headers.delete("Content-Length");
    return new Response(null, { status: unmodified ? 304 : 200, headers });
  }
  return new Response(response.body, { headers });
}
