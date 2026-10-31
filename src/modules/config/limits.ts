/**
 * C 级：代码内部常量（不进设置页、不读环境变量）。
 *
 * 这里是“写死的数值”的唯一出处：前后端、Zod 契约与界面 maxLength 都从这里取值，
 * 不再在多个文件里各写一份。修改这些值属于代码变更，需要同时考虑存量数据与平台限制。
 */
export const KiB = 1024;
export const MiB = 1024 * 1024;

// ---------- 上传与媒体 ----------
/**
 * 单个上传文件的硬上限（MB）。设置页只能在 1–50 之间调整，读取配置时会再夹紧一次。
 * 原因：当前上传路径会把整个文件读入 Worker 内存（boundedBody → formData → arrayBuffer），
 * Workers 单个 isolate 约 128 MB 内存；超过 50 MB 需要先改为流式上传（见报告的“暂缓项”）。
 */
export const HARD_MAX_UPLOAD_MB = 50;
export const HARD_MAX_UPLOAD_BYTES = HARD_MAX_UPLOAD_MB * MiB;
/** multipart 包装（边界、字段名、postId）额外开销：请求体上限 = 文件上限 + 该值。 */
export const MULTIPART_OVERHEAD_BYTES = 1 * MiB;
/** AI 生成图片从供应商下载时的上限：与上传硬上限相同，不另设 25 MB。 */
export const GENERATED_IMAGE_MAX_BYTES = HARD_MAX_UPLOAD_BYTES;
/** 媒体文件名截断长度。 */
export const MEDIA_FILENAME_MAX = 200;

export type MediaCategory = "image" | "audio" | "video" | "document";
/** 允许上传的 MIME 白名单（SVG/HTML 不在范围内）；设置页只能在此基础上“关闭”，不能新增。 */
export const MEDIA_TYPES = [
  { mime: "image/png", category: "image", label: "PNG" },
  { mime: "image/jpeg", category: "image", label: "JPEG" },
  { mime: "image/webp", category: "image", label: "WebP" },
  { mime: "image/gif", category: "image", label: "GIF" },
  { mime: "image/avif", category: "image", label: "AVIF" },
  { mime: "audio/mpeg", category: "audio", label: "MP3" },
  { mime: "audio/wav", category: "audio", label: "WAV" },
  { mime: "audio/x-wav", category: "audio", label: "WAV" },
  { mime: "audio/ogg", category: "audio", label: "OGG" },
  { mime: "audio/mp4", category: "audio", label: "M4A" },
  { mime: "video/mp4", category: "video", label: "MP4" },
  { mime: "video/webm", category: "video", label: "WebM" },
  // macOS 录屏 / iPhone 的 .mov。按原 MIME 存储与返回；能否播放取决于编码（H.264 可在 Chrome、Safari 播放）。
  { mime: "video/quicktime", category: "video", label: "MOV" },
  { mime: "application/pdf", category: "document", label: "PDF" },
  { mime: "application/epub+zip", category: "document", label: "EPUB" },
  { mime: "application/zip", category: "document", label: "ZIP" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    category: "document",
    label: "DOCX",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "document",
    label: "XLSX",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    category: "document",
    label: "PPTX",
  },
  { mime: "text/plain", category: "document", label: "TXT" },
  { mime: "text/markdown", category: "document", label: "Markdown" },
  { mime: "text/csv", category: "document", label: "CSV" },
] as const satisfies readonly {
  mime: string;
  category: MediaCategory;
  label: string;
}[];
export type MediaMime = (typeof MEDIA_TYPES)[number]["mime"];
export const MEDIA_MIME_LIST = MEDIA_TYPES.map((t) => t.mime) as MediaMime[];
export const MEDIA_CATEGORY_LABELS: Record<MediaCategory, string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
  document: "文档",
};

// ---------- 正文与请求体 ----------
/** 正文（blocks JSON / Markdown 字段）字符上限；服务端校验与编辑器导入共用。 */
export const MAX_DOCUMENT_CHARS = 1_000_000;
/** JSON 请求体上限：正文上限 + 10% 余量给元数据字段。 */
export const MAX_JSON_BODY_BYTES = 1_100_000;
/** 正文 JSON 嵌套深度上限：服务端 validation 与编辑器 content-check 共用（原来 30 / 40 不一致）。 */
export const MAX_CONTENT_DEPTH = 30;
/** 正文 JSON 节点数上限。 */
export const MAX_CONTENT_NODES = 50_000;
/** Markdown 导入文件的硬上限（KB）：不超过正文字符上限对应的字节数。 */
export const HARD_MAX_MARKDOWN_IMPORT_KB = Math.floor(MAX_DOCUMENT_CHARS / KiB);
/**
 * 一次性读取列表的安全上限（首页 / RSS / sitemap / 工作台文章列表）。
 * 命中时会写 warn 日志（content.list_truncated）；分页属于后续项。
 */
export const QUERY_SAFETY_LIMIT = 1000;

// ---------- 文本长度（契约与界面 maxLength 共用） ----------
export const TEXT_LIMITS = {
  siteTitle: 80,
  tagline: 240,
  postTitle: 240,
  slug: 160,
  excerpt: 1000,
  category: 100,
  tag: 60,
  tags: 20,
  navLabel: 40,
  navItems: 12,
  url: 2048,
  prompts: 40,
  promptName: 80,
  promptTemplate: 8000,
  providers: 12,
  providerName: 80,
  modelId: 160,
  customCode: 20000,
  tokenName: 80,
  email: 254,
  loginPassword: 1024,
  postPasswordMin: 8,
  postPasswordMax: 128,
  aiSelection: 40000,
  imagePrompt: 4000,
} as const;
/** slugify 会追加 “-” + 6 位 ID，所以生成部分要预留 7 个字符。 */
export const SLUG_SUFFIX_LENGTH = 7;

// ---------- AI ----------
/** 新建 AI 供应商时的默认参数与可填范围（契约、设置页、运行时回退共用）。 */
export const AI_PARAMS = {
  temperature: { default: 0.7, min: 0, max: 2, step: 0.1 },
  maxTokens: { default: 2048, min: 16, max: 16384 },
} as const;
/** AI 文本输出截断长度。 */
export const AI_OUTPUT_MAX_CHARS = 100_000;
/** 供应商响应体上限（字节）。 */
export const PROVIDER_RESPONSE_MAX_BYTES = 35_000_000;
/** 生成图片下载超时。 */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;
/** 拉取模型列表超时。 */
export const MODEL_LIST_TIMEOUT_MS = 15_000;
/** AI 请求超时的硬上限（秒）：Workers 单请求墙钟限制内留余量。 */
export const HARD_MAX_AI_TIMEOUT_SECONDS = 180;

// ---------- 账号与安全 ----------
/** SESSION_SECRET 最短长度（作者会话、Google 会话、文章密码 Cookie 共用）。 */
export const SESSION_SECRET_MIN_LENGTH = 32;

/** 展示图配方：改编码器/质量/尺寸时必须升级版本，不覆盖原媒体对象。 */
export const IMAGE_RECIPE = "v1";
export const IMAGE_WIDTHS = [480, 960] as const;
export const IMAGE_QUALITY = 80;
// Workers 128MiB 内存：从读取原图字节起串行处理，在解码前限制分配。
export const IMAGE_MAX_PIXELS = 4_000_000;
export const IMAGE_MAX_SIDE = 8192;
export const IMAGE_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const IMAGE_BROWSER_TTL = 60;
/**
 * 上传落库配方：静态 PNG/JPEG/WebP 在保存时等比缩到最大宽度并转 WebP，R2 只保存这份结果（不保留大原图）。
 * 最大宽度必须等于 IMAGE_WIDTHS 最大档：/api/images/.../960.webp 直接返回落库对象，不再另存一份 960 衍生。
 * 不放进设置页：srcset 宽度描述、衍生 URL 和存量迁移都依赖这个值，修改必须升级 IMAGE_STORE_RECIPE 并迁移。
 */
export const IMAGE_STORE_RECIPE = "s1";
export const IMAGE_STORE_MAX_WIDTH = 960;
export const IMAGE_STORE_QUALITY = 80;
/** 一次性迁移脚本在本机 Node 中运行，不受 Workers 128MiB 限制，可处理历史大图。 */
export const IMAGE_MIGRATION_MAX_PIXELS = 100_000_000;
export const IMAGE_MIGRATION_MAX_SIDE = 20_000;
export const IMAGE_EDGE_TTL = 600;
/** 不透明令牌前缀与格式：API 令牌、作者会话、Google 会话共用。 */
export const OPAQUE_TOKEN_PREFIX = "mm_";
export const OPAQUE_TOKEN_BYTES = 32;
export const OPAQUE_TOKEN_PATTERN = /^mm_[a-f0-9]{64}$/;
/** 会话时长硬上限（小时）。 */
export const HARD_MAX_SESSION_HOURS = 168;
/** API 令牌有效期硬上限（天）。 */
export const HARD_MAX_TOKEN_DAYS = 365;
/** 文章解锁 Cookie 硬上限（分钟，30 天）。 */
export const HARD_MAX_UNLOCK_MINUTES = 43_200;
/**
 * 文章密码 PBKDF2-SHA256 迭代次数。
 * Cloudflare 生产 Workers 的 WebCrypto 拒绝 > 100000 次的 PBKDF2（NotSupportedError），
 * 本地 workerd 不受此限，所以本地测试通过不代表线上可用。验证时按白名单接受，便于平台放开后升级。
 */
export const POST_PASSWORD_KDF_ITERATIONS = 100_000;
export const POST_PASSWORD_KDF_ACCEPTED = [100_000, 600_000] as const;
/** 固定的登录/解锁限流（防爆破，不开放给设置页）。 */
export const AUTH_RATE_LIMITS = {
  authorLogin: { limit: 5, windowSeconds: 300 },
  googleLogin: { limit: 20, windowSeconds: 300 },
  unlock: { limit: 8, windowSeconds: 300 },
} as const;
/** Google 登录流程（state/PKCE）有效期。 */
export const GOOGLE_FLOW_SECONDS = 600;

// ---------- 嵌入 ----------
/** X 等自适应高度嵌入的高度夹紧范围（像素）。 */
export const EMBED_HEIGHT_RANGE = { min: 80, max: 4000 } as const;

/** 浏览器本地导出的目录规则与存储版本，不上传服务器。 */
export const OBSIDIAN_LOCAL_DEFAULTS = {
  noteDirectory: "笔记",
  imageRule: "../asset",
  databaseName: "mademe-obsidian-local",
  databaseVersion: 1,
  presetStore: "presets",
  manifestName: ".mademe-export.json",
  manifestVersion: 1,
  fileNameMax: 180,
  fileSuffixMax: 48,
  extensionMax: 20,
} as const;

/** 文章类型目录容量与乐观并发的有界重试。 */
export const ARTICLE_TYPE_LIMIT = 100;
export const ARTICLE_TYPE_CAS_ATTEMPTS = 4;
