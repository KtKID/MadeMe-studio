import {
  requestCancellation,
  throwIfAborted,
} from "../../src/shared/request-cancellation.ts";
import {
  POST_SCHEMA_ACCEPT,
  createPostSchema,
  postMutationResponseSchema,
  publishInputSchema,
  mediaResponseSchema,
  type PostReceipt,
} from "../../src/shared/contracts.ts";
import {
  prepareAttachments,
  applyMediaKinds,
  type Attachment,
  type ResolveOptions,
  type AttachmentCache,
} from "../../src/modules/markdown-import/attachments.ts";
import { markdownToBlocks } from "../../src/modules/markdown-import/blocks.ts";

/** 三种按需发布入口复用同一个请求协议，不另造 BlockNote JSON。 */
import { DEFAULT_CONFIG } from "../../src/modules/config/defaults.ts";
import {
  KiB,
  OPAQUE_TOKEN_PATTERN,
  INTEGRATION_REQUEST_TIMEOUT_MS,
  INTEGRATION_MEDIA_UPLOAD_TIMEOUT_MS,
} from "../../src/modules/config/limits.ts";
/** 与站内编辑器“Markdown 导入上限”的默认值同源（src/modules/config）。 */
export const MAX_MARKDOWN_BYTES =
  DEFAULT_CONFIG.upload.markdownImportMaxKB * KiB;
export const REQUIRED_DRAFT_SCOPE = "posts:write";
export const REQUIRED_PUBLISH_SCOPE = "posts:publish";
type ClientOptions = {
  site: string;
  token: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};
export type PublishResult = PostReceipt & {
  visibility: "draft" | "public" | "unlisted";
  studioUrl: string;
};
type MutationResult = ReturnType<typeof postMutationResponseSchema.parse> & {
  studioUrl: string;
};

export function normalizeSiteUrl(value: string): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(
      "Enter a valid site origin, such as https://your-site.example.",
    );
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete HTTPS site origin.");
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(
      "HTTPS is required, except http://localhost or http://127.0.0.1 for development.",
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use only the site origin: no credentials, path, query, or fragment.",
    );
  }
  return url.origin;
}

export function hostPermissionPattern(site: string): string {
  const url = new URL(normalizeSiteUrl(site));
  // Chrome 主机权限跨端口；实际请求仍只发送到配置中的精确原点。
  return `${url.protocol}//${url.hostname}/*`;
}

export function normalizeToken(value: string): string {
  if (typeof value !== "string" || !OPAQUE_TOKEN_PATTERN.test(value.trim())) {
    throw new Error(
      "Enter a valid MadeMe API token from Studio → Integrations.",
    );
  }
  return value.trim();
}

export function normalizeMarkdown(value: string): string {
  if (typeof value !== "string") throw new Error("Markdown must be text.");
  const markdown = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!markdown.trim())
    throw new Error("Choose a non-empty Markdown note or selection.");
  if (markdown.includes("\0"))
    throw new Error("Markdown cannot contain NUL bytes.");
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES) {
    throw new Error(
      `Markdown exceeds the integration limit of ${MAX_MARKDOWN_BYTES / KiB} KiB.`,
    );
  }
  return markdown;
}

export function draftInput({
  title,
  markdown,
}: {
  title: string;
  markdown: string;
}) {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 240 ||
    /[\r\n\u0000-\u001f\u007f]/.test(title)
  ) {
    throw new Error("The title must be a single line of 1–240 characters.");
  }
  const parsed = createPostSchema.parse({
    title: title.trim(),
    markdown: normalizeMarkdown(markdown),
    visibility: "draft",
  });
  return {
    title: parsed.title,
    markdown: parsed.markdown!,
    visibility: "draft" as const,
  };
}

export function titleFromMarkdown(
  markdown: string,
  fallback = "Untitled note",
): string {
  const heading = markdown
    .replace(/^\uFEFF/, "")
    .match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  return (
    (heading || fallback)
      .replace(/[\r\n\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 240) || "Untitled note"
  );
}

export function sourceUrl(value: string): string {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Only ordinary HTTP(S) page URLs can be clipped.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Only ordinary HTTP(S) page URLs without credentials can be clipped.",
    );
  }
  // Query 可能含访问凭据；默认不导出 query 与 fragment。
  url.search = "";
  url.hash = "";
  return url.href;
}

export function clipMarkdown(selection: string, url: string): string {
  const source = sourceUrl(url);
  const text = typeof selection === "string" ? selection.trim() : "";
  // 页面选区只作为引用文本，不执行 HTML，也不生成 Markdown 图片请求。
  const quoted = text
    .replace(/\\/g, "\\\\")
    .replace(/[\[\]`*_<>!]/g, "\\$&")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return normalizeMarkdown(`${text ? `${quoted}\n\n` : ""}Source: ${source}\n`);
}

export function publishInput({
  id,
  version,
  visibility,
}: {
  id: string;
  version: number;
  visibility: string;
}) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new Error("A valid post ID is required.");
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error("The exact positive draft version is required.");
  if (!["public", "unlisted"].includes(visibility))
    throw new Error("Explicitly choose public or unlisted visibility.");
  const body = publishInputSchema.parse({ version, visibility });
  return {
    id,
    body: {
      version: body.version,
      visibility: visibility as "public" | "unlisted",
    },
  };
}

const ERROR_MESSAGES: Record<number, string> = {
  401: "Token was not accepted. Check its value and expiration.",
  403: "Token lacks permission for this action.",
  404: "API or post not found. Check the configured site origin and post ID.",
  409: "The draft changed. Review the latest version in Studio before publishing.",
  413: "The server rejected this content as too large.",
  422: "The server rejected the content. Review links and Markdown in Studio.",
  429: "Rate limit reached. Wait before trying again.",
};

async function requestPost({
  site,
  token,
  path,
  body,
  signal,
  fetchImpl = globalThis.fetch,
}: ClientOptions & { path: string; body: unknown }): Promise<MutationResult> {
  const origin = normalizeSiteUrl(site);
  const authorization = `Bearer ${normalizeToken(token)}`;
  const cancellation = requestCancellation(
    signal,
    INTEGRATION_REQUEST_TIMEOUT_MS,
  );
  let response: Response | undefined;
  try {
    throwIfAborted(cancellation.signal);
    response = await fetchImpl(`${origin}${path}`, {
      method: "POST", // Accept 声明可读取的响应版本（CORS 安全头）；旧服务端忽略参数，新服务端据此返回完整字段。
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: POST_SCHEMA_ACCEPT,
      },
      body: JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: cancellation.signal,
    });
    if (!response.ok)
      throw new Error(
        ERROR_MESSAGES[response.status] ||
          `Request failed (HTTP ${response.status}). Check Studio before retrying.`,
      );
    const parsed = postMutationResponseSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(parsed.data.post.id)
    ) {
      throw new Error(
        "Unexpected API response. Check Studio before retrying to avoid duplicate drafts.",
      );
    }
    return { post: parsed.data.post, studioUrl: `${origin}/studio` };
  } catch (error) {
    if (response) {
      if (error instanceof SyntaxError)
        throw new Error(
          "The API did not return JSON. Check Studio before retrying.",
        );
      throw error;
    }
    // 网络错误可能含 URL 或凭据；诊断只返回固定提示，不反射原始响应。
    throw new Error(
      "Connection failed, timed out, or redirected. Check the site and Studio before retrying; the request may have succeeded.",
    );
  } finally {
    cancellation.dispose();
  }
}

export async function createDraft(
  options: ClientOptions & { title: string; markdown: string },
): Promise<PublishResult> {
  const { post, studioUrl } = await requestPost({
    ...options,
    path: "/api/posts",
    body: draftInput(options),
  });
  if ("visibility" in post && post.visibility !== "draft")
    throw new Error(
      "The server returned a non-draft post. Review it in Studio immediately.",
    );
  // 仅写 Token 只拿到 id/version；可见性来自本次明确请求，不额外 GET 正文。
  return { id: post.id, version: post.version, visibility: "draft", studioUrl };
}

/** 上传目标固定为配置站点，不替用户拉取远端地址。附件 Token 另需 media:write。 */
export async function uploadAttachment(
  options: ClientOptions & { file: File },
) {
  const origin = normalizeSiteUrl(options.site);
  const body = new FormData();
  body.append("file", options.file);
  const cancellation = requestCancellation(
    options.signal,
    INTEGRATION_MEDIA_UPLOAD_TIMEOUT_MS,
  );
  try {
    let response: Response;
    try {
      throwIfAborted(cancellation.signal);
      response = await (options.fetchImpl || fetch)(`${origin}/api/media`, {
        method: "POST",
        body,
        headers: { Authorization: `Bearer ${normalizeToken(options.token)}` },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: cancellation.signal,
      });
    } catch {
      throw new Error(
        "附件上传连接失败、超时、取消或遇到重定向，文章尚未保存。请核对媒体库后重试。",
      );
    }
    if (!response.ok)
      throw new Error(
        `附件上传失败（HTTP ${response.status}）。含附件的 Token 需要 media:write；未保存文章，请检查媒体库后重试。`,
      );
    const parsed = mediaResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("附件上传响应格式异常，未保存文章。");
    return parsed.data.media;
  } finally {
    cancellation.dispose();
  }
}

/** Obsidian 与网页共用解析、路径边界、去重及 MIME 转换，正文和附件全部就绪后才创建私有草稿。 */
export async function createDraftWithAttachments(
  options: ClientOptions & {
    title: string;
    markdown: string;
    assets: Attachment[];
    resolve: ResolveOptions;
    cache?: AttachmentCache;
    readAttachment?: (asset: Attachment) => Promise<File>;
  },
) {
  normalizeSiteUrl(options.site);
  normalizeToken(options.token);
  const input = draftInput(options);
  const prepared = await prepareAttachments(
    input.markdown,
    options.assets,
    options.resolve,
    (file) => uploadAttachment({ ...options, file }),
    {
      signal: options.signal,
      cache: options.cache,
      readFile: options.readAttachment,
    },
  );
  throwIfAborted(options.signal);
  const blocks = applyMediaKinds(
    markdownToBlocks(prepared.markdown),
    prepared.mimeByUrl,
  );
  const body = createPostSchema.parse({
    title: input.title,
    blocks,
    visibility: "draft",
  });
  const { post, studioUrl } = await requestPost({
    ...options,
    path: "/api/posts",
    body,
  });
  if ("visibility" in post && post.visibility !== "draft")
    throw new Error("服务器返回了非草稿文章，请到 Studio 核对。");
  return {
    id: post.id,
    version: post.version,
    visibility: "draft" as const,
    studioUrl,
  };
}

export async function publishPost(
  options: ClientOptions & { id: string; version: number; visibility: string },
): Promise<PublishResult> {
  const { id, body } = publishInput(options);
  const { post, studioUrl } = await requestPost({
    ...options,
    path: `/api/posts/${encodeURIComponent(id)}/publish`,
    body,
  });
  if (post.id !== id)
    throw new Error(
      "The server returned a different article. Review the post in Studio.",
    );
  if ("visibility" in post && post.visibility !== body.visibility)
    throw new Error(
      "The server returned a different visibility. Review the post in Studio.",
    );
  return {
    id: post.id,
    version: post.version,
    visibility: body.visibility,
    studioUrl,
  };
}
