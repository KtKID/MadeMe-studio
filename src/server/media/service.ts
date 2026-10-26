import { acceptedMediaMimeTypes, type Media } from "../../shared/contracts";
import type { RuntimeEnv } from "../runtime";
import { AppError, notFound } from "../errors";
import type { Identity } from "../auth/identity";
import {
  D1PostRepository,
  MEDIA_REFERENCE_PAGE_SIZE,
} from "../content/repository";
import { canReadPost } from "../auth/access";
import { referencesMedia } from "../content/validation";
type MediaRow = {
  id: string;
  object_key: string;
  name: string;
  mime: string;
  size: number;
  post_id: string | null;
  source: "upload" | "generated";
  prompt: string | null;
  created_at: string;
};
const MAX_BYTES = 25 * 1024 * 1024;
const allowed = new Set<string>(acceptedMediaMimeTypes);
export function validateMedia(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      "Files must be between 1 byte and 25 MB.",
    );
  if (!allowed.has(mime))
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA",
      "This file type is not supported. SVG and HTML files are not accepted.",
    );
  const start = String.fromCharCode(...bytes.slice(0, 16));
  const match =
    mime === "image/png"
      ? bytes[0] === 137 && start.slice(1, 4) === "PNG"
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === "image/gif"
          ? /^GIF8[79]a/.test(start)
          : mime === "image/webp"
            ? start.startsWith("RIFF") && start.slice(8, 12) === "WEBP"
            : mime === "image/avif"
              ? start.slice(4, 8) === "ftyp" &&
                ["avif", "avis"].includes(start.slice(8, 12))
              : mime === "application/pdf"
                ? start.startsWith("%PDF-")
                : mime.includes("zip") || mime.includes("openxmlformats")
                  ? start.startsWith("PK")
                  : mime === "audio/wav" || mime === "audio/x-wav"
                    ? start.startsWith("RIFF") && start.slice(8, 12) === "WAVE"
                    : mime === "audio/ogg"
                      ? start.startsWith("OggS")
                      : mime === "video/webm"
                        ? bytes[0] === 0x1a &&
                          bytes[1] === 0x45 &&
                          bytes[2] === 0xdf &&
                          bytes[3] === 0xa3
                        : mime === "audio/mp4" || mime === "video/mp4"
                          ? start.slice(4, 8) === "ftyp"
                          : mime === "audio/mpeg"
                            ? start.startsWith("ID3") ||
                              (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)
                            : true;
  if (!match)
    throw new AppError(
      415,
      "MEDIA_SIGNATURE_MISMATCH",
      "The file does not match its declared type.",
    );
  if (mime.startsWith("text/") && bytes.some((v) => v === 0))
    throw new AppError(415, "INVALID_TEXT", "The file is not plain text.");
}
function publicMedia(row: MediaRow): Media {
  return {
    id: row.id,
    name: row.name,
    url: `/api/files/${row.id}`,
    mime: row.mime,
    size: row.size,
    createdAt: row.created_at,
    postId: row.post_id,
    source: row.source,
    ...(row.prompt ? { prompt: row.prompt } : {}),
  };
}
export async function saveMedia(
  env: RuntimeEnv,
  bytes: Uint8Array,
  input: {
    name: string;
    mime: string;
    postId?: string;
    source?: "upload" | "generated";
    prompt?: string;
  },
) {
  if (!env.DB || !env.BUCKET)
    throw new AppError(
      503,
      "MEDIA_NOT_CONFIGURED",
      "D1 and R2 bindings are required for media storage.",
    );
  validateMedia(bytes, input.mime);
  if (input.postId && !(await new D1PostRepository(env.DB).get(input.postId)))
    throw notFound();
  const id = crypto.randomUUID();
  const name =
    input.name.replace(/[\x00-\x1f\x7f/\\"]/g, "_").slice(0, 200) || "file";
  const row: MediaRow = {
    id,
    object_key: `media/${id}`,
    name,
    mime: input.mime,
    size: bytes.length,
    post_id: input.postId ?? null,
    source: input.source ?? "upload",
    prompt: input.prompt ?? null,
    created_at: new Date().toISOString(),
  };
  await env.BUCKET.put(row.object_key, bytes, {
    httpMetadata: { contentType: row.mime },
  });
  try {
    await env.DB.prepare(
      "INSERT INTO media (id,object_key,name,mime,size,post_id,source,prompt,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        row.id,
        row.object_key,
        row.name,
        row.mime,
        row.size,
        row.post_id,
        row.source,
        row.prompt,
        row.created_at,
      )
      .run();
  } catch (error) {
    await env.BUCKET.delete(row.object_key);
    throw error;
  }
  return publicMedia(row);
}
export async function listMedia(
  env: RuntimeEnv,
  query: string,
  source: string | null,
) {
  const rows = (
    await env
      .DB!.prepare(
        "SELECT * FROM media WHERE (? IS NULL OR source=?) ORDER BY created_at DESC LIMIT 100",
      )
      .bind(source, source)
      .all<MediaRow>()
  ).results;
  const q = query.toLowerCase();
  return rows
    .filter(
      (r) => !q || `${r.name} ${r.prompt ?? ""}`.toLowerCase().includes(q),
    )
    .map(publicMedia);
}
export async function serveMedia(
  request: Request,
  env: RuntimeEnv,
  identity: Identity,
  id: string,
) {
  if (!env.DB || !env.BUCKET) throw notFound();
  const row = await env.DB.prepare("SELECT * FROM media WHERE id=?")
    .bind(id)
    .first<MediaRow>();
  if (!row) throw notFound();
  if (!identity.owner) {
    let permitted = false;
    const repository = new D1PostRepository(env.DB);
    let afterId = "";
    while (!permitted) {
      const candidates = await repository.publishedMediaCandidates(id, afterId);
      if (!candidates.length) break;
      for (const post of candidates) {
        // 候选查询只缩小范围；实际引用、删除状态和密码授权仍逐篇复核。
        if (
          post.published &&
          referencesMedia(post.published, id) &&
          (await canReadPost(request, env, identity, post))
        ) {
          permitted = true;
          break;
        }
      }
      if (candidates.length < MEDIA_REFERENCE_PAGE_SIZE) break;
      afterId = candidates[candidates.length - 1].draft.id;
    }
    if (!permitted) throw notFound();
  }
  const object = await env.BUCKET.get(row.object_key);
  if (!object) throw notFound();
  const inline =
    /^(image|audio|video)\//.test(row.mime) &&
    new URL(request.url).searchParams.get("download") !== "1";
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(object.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${row.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
