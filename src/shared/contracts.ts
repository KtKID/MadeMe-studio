import { z } from "zod";
// 显式写 .ts 文件路径：integrations/ 下的 Node 工具直接用 Node 类型剥离加载本文件，
// 不支持目录导入或省略扩展名。
import {
  AI_PARAMS,
  HARD_MAX_TOKEN_DAYS,
  MAX_DOCUMENT_CHARS,
  MEDIA_MIME_LIST,
  OPAQUE_TOKEN_PATTERN,
  TEXT_LIMITS,
} from "../modules/config/limits.ts";
import {
  runtimeConfigPatchSchema,
  runtimeConfigSchema,
} from "../modules/config/schema.ts";
import { uploadProblem, type UploadProblem } from "../modules/config/public.ts";

export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export const jsonValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export type EditorBlock = { [key: string]: JSONValue };
const primitivePropSchema = z.union([
  z.string().max(20_000),
  z.number(),
  z.boolean(),
  z.null(),
]);
const blockPropsSchema = z.record(z.string(), primitivePropSchema);
const textStyleSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
    textColor: z.string().max(100).optional(),
    backgroundColor: z.string().max(100).optional(),
  })
  .strict();
const styledTextSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(MAX_DOCUMENT_CHARS),
    styles: textStyleSchema.optional(),
  })
  .strict();
const inlineElementSchema = z.union([
  styledTextSchema,
  z
    .object({
      type: z.literal("link"),
      href: z.string().max(2048),
      content: z.union([z.string(), z.array(styledTextSchema).max(20000)]),
    })
    .strict(),
]);
const inlineContentSchema = z.union([
  z.string().max(MAX_DOCUMENT_CHARS),
  z.array(inlineElementSchema).max(20000),
]);
const tableCellSchema = z.union([
  z.array(inlineElementSchema).max(20000),
  z
    .object({
      type: z.literal("tableCell"),
      props: blockPropsSchema.optional(),
      content: z.array(inlineElementSchema).max(20000),
    })
    .strict(),
]);
const tableContentSchema = z
  .object({
    type: z.literal("tableContent"),
    columnWidths: z
      .array(z.number().nonnegative().nullable())
      .max(100)
      .optional(),
    headerRows: z.number().int().nonnegative().max(1000).optional(),
    headerCols: z.number().int().nonnegative().max(100).optional(),
    rows: z
      .array(
        z.object({ cells: z.array(tableCellSchema).min(1).max(100) }).strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
const noContentTypes = new Set([
  "audio",
  "video",
  "image",
  "file",
  "divider",
  "embed",
]);
/** 块类型及内容结构必须可被 BlockNote 和 SSR 安全消费，不接受任意 JSON 充当文章。 */
export const editorBlockSchema: z.ZodType<EditorBlock> = z.lazy(() =>
  z
    .object({
      id: z.string().max(128).optional(),
      type: z.enum([
        "paragraph",
        "heading",
        "bulletListItem",
        "numberedListItem",
        "checkListItem",
        "toggleListItem",
        "quote",
        "codeBlock",
        "table",
        "image",
        "audio",
        "video",
        "file",
        "divider",
        "embed",
      ]),
      props: blockPropsSchema.optional(),
      content: jsonValueSchema.optional(),
      children: z.array(editorBlockSchema).max(2000).optional(),
    })
    .strict()
    .superRefine((block, ctx) => {
      if (block.type === "table") {
        const parsed = tableContentSchema.safeParse(block.content);
        if (!parsed.success)
          ctx.addIssue({
            code: "custom",
            path: ["content"],
            message:
              "Invalid BlockNote table content: every row requires a cells array.",
          });
      } else if (noContentTypes.has(block.type)) {
        if (
          block.content !== undefined &&
          block.content !== "" &&
          !(Array.isArray(block.content) && block.content.length === 0)
        )
          ctx.addIssue({
            code: "custom",
            path: ["content"],
            message: "This block type cannot contain inline content.",
          });
      } else if (
        block.content !== undefined &&
        !inlineContentSchema.safeParse(block.content).success
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["content"],
          message: "Invalid BlockNote inline content.",
        });
      }
    }),
) as z.ZodType<EditorBlock>;
export const blocksSchema = z.array(editorBlockSchema).max(2000);
export const visibilitySchema = z.enum([
  "public",
  "draft",
  "password",
  "unlisted",
]);
export type Visibility = z.infer<typeof visibilitySchema>;
const localOrHttps = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      v === "" ||
      /^\/api\/files\/[a-zA-Z0-9-]+$/.test(v) ||
      /^https:\/\//i.test(v),
    "Use an uploaded file or an HTTPS URL",
  );
export const editablePostSchema = z.object({
  title: z.string().trim().min(1).max(TEXT_LIMITS.postTitle),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(TEXT_LIMITS.slug),
  excerpt: z.string().max(TEXT_LIMITS.excerpt),
  blocks: blocksSchema,
  category: z.string().trim().max(TEXT_LIMITS.category),
  tags: z
    .array(z.string().trim().min(1).max(TEXT_LIMITS.tag))
    .max(TEXT_LIMITS.tags),
  coverImage: localOrHttps,
  visibility: visibilitySchema,
  pinned: z.boolean(),
});
export const postSchema = editablePostSchema.extend({
  id: z.string(),
  version: z.number().int().positive(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Post = z.infer<typeof postSchema>;
/** 工作台列表只携带展示字段，正文与发布快照留在按需编辑/阅读路径。 */
export const postSummarySchema = postSchema.pick({
  id: true,
  version: true,
  title: true,
  excerpt: true,
  category: true,
  tags: true,
  coverImage: true,
  visibility: true,
  pinned: true,
  publishedAt: true,
  updatedAt: true,
  deletedAt: true,
});
export type PostSummary = z.infer<typeof postSummarySchema>;
/** 无读取权限的发布客户端仅获得操作回执，不能通过写接口读出既有正文。 */
export const postReceiptSchema = postSchema
  .pick({ id: true, version: true })
  .strict();
export type PostReceipt = z.infer<typeof postReceiptSchema>;
export const postMutationResponseSchema = z
  .object({ post: z.union([postSchema.strict(), postReceiptSchema]) })
  .strict();
export type PostMutationResponse = z.infer<typeof postMutationResponseSchema>;
export const createPostSchema = editablePostSchema
  .partial()
  .extend({
    title: editablePostSchema.shape.title,
    blocks: blocksSchema.default([]),
    markdown: z.string().max(MAX_DOCUMENT_CHARS).optional(),
    password: z.string().min(TEXT_LIMITS.postPasswordMin).max(TEXT_LIMITS.postPasswordMax).optional(),
  })
  .strict();
export const patchPostSchema = editablePostSchema
  .partial()
  .extend({
    version: z.number().int().positive(),
    password: z.string().min(TEXT_LIMITS.postPasswordMin).max(TEXT_LIMITS.postPasswordMax).optional(),
  })
  .strict();
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PatchPostInput = z.infer<typeof patchPostSchema>;
export const versionInputSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const publishInputSchema = versionInputSchema
  .extend({
    visibility: z.enum(["public", "password", "unlisted"]).optional(),
    password: z.string().min(TEXT_LIMITS.postPasswordMin).max(TEXT_LIMITS.postPasswordMax).optional(),
  })
  .strict();
export const unlockInputSchema = z
  .object({ password: z.string().max(TEXT_LIMITS.postPasswordMax) })
  .strict();

export const aiActionSchema = z.enum([
  "rewrite",
  "polish",
  "expand",
  "translate",
  "title",
  "excerpt",
  "tags",
  "slug",
]);
export type AIAction = z.infer<typeof aiActionSchema>;
export const providerSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(64),
  name: z.string().min(1).max(TEXT_LIMITS.providerName),
  kind: z.enum(["openai", "openrouter", "siliconflow", "cloudflare", "gemini"]),
  model: z.string().min(1).max(TEXT_LIMITS.modelId),
  imageModel: z.string().trim().min(1).max(TEXT_LIMITS.modelId).optional(),
  temperature: z
    .number()
    .min(AI_PARAMS.temperature.min)
    .max(AI_PARAMS.temperature.max)
    .default(AI_PARAMS.temperature.default),
  maxTokens: z
    .number()
    .int()
    .min(AI_PARAMS.maxTokens.min)
    .max(AI_PARAMS.maxTokens.max)
    .default(AI_PARAMS.maxTokens.default),
  configured: z.boolean().default(false),
  textConfigured: z.boolean().optional(),
  imageConfigured: z.boolean().optional(),
});
export type Provider = z.infer<typeof providerSchema>;
export const promptSchema = z.object({
  id: z.string().max(64),
  name: z.string().min(1).max(80),
  action: aiActionSchema,
  template: z.string().min(1).max(8000),
  providerId: z.string().max(64).optional(),
});
export const modeSchema = z.enum(["light", "dark", "system"]);
export const skinSchema = z.enum(["amber", "sage", "rose", "ocean", "mono"]);
export const settingsSchema = z.object({
  siteTitle: z.string().trim().min(1).max(TEXT_LIMITS.siteTitle),
  tagline: z.string().max(TEXT_LIMITS.tagline),
  theme: z.enum(["paper", "ink", "garden", "mono"]),
  mode: modeSchema.default("system"),
  skin: skinSchema.default("amber"),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  font: z.enum(["yahei", "sans", "serif", "mono"]),
  navigation: z
    .array(
      z.object({
        label: z.string().min(1).max(TEXT_LIMITS.navLabel),
        href: z
          .string()
          .max(TEXT_LIMITS.url)
          .refine(
            (v) => /^\/(?!\/)/.test(v) || /^https:\/\//i.test(v),
            "Use a root-relative or HTTPS URL",
          ),
      }),
    )
    .max(TEXT_LIMITS.navItems),
  prompts: z.array(promptSchema).max(TEXT_LIMITS.prompts),
  providers: z.array(providerSchema).max(TEXT_LIMITS.providers),
  customCode: z.string().max(TEXT_LIMITS.customCode),
  /**
   * A 级可调配置（src/modules/config）：宽松读取，缺失/越界逐字段回退或夹紧，永不让读取失败。
   * D1 只保存作者改过的字段。
   */
  // 旧数据没有 limits：Zod 4 把 transform 字段当必填，所以先 optional 再补默认值。
  limits: runtimeConfigSchema
    .optional()
    .transform((value) => value ?? runtimeConfigSchema.parse({})),
});
export type Settings = z.infer<typeof settingsSchema>;
export const patchSettingsSchema = settingsSchema
  .partial()
  .extend({
    mode: modeSchema.optional(),
    skin: skinSchema.optional(),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    /** 严格校验：越界直接 422 并返回中文原因；null 表示恢复默认。 */
    limits: runtimeConfigPatchSchema.optional(),
  })
  .strict();
export const defaultSettings: Settings = {
  siteTitle: "MadeMe",
  tagline: "A quiet place for ideas that matter.",
  theme: "paper",
  mode: "system",
  skin: "amber",
  accent: null,
  font: "yahei",
  navigation: [{ label: "Journal", href: "/" }],
  prompts: [],
  providers: [],
  customCode: "",
  limits: runtimeConfigSchema.parse({}),
};
export const mediaSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: z.string(),
  postId: z.string().nullable(),
  source: z.enum(["upload", "generated"]),
  prompt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type Media = z.infer<typeof mediaSchema>;
export const aiInputSchema = z
  .object({
    action: aiActionSchema,
    selection: z.string().min(1).max(TEXT_LIMITS.aiSelection),
    postId: z.string().optional(),
    promptId: z.string().optional(),
    providerId: z.string().optional(),
    language: z.string().max(60).optional(),
  })
  .strict();
export const imageInputSchema = z
  .object({
    prompt: z.string().min(1).max(TEXT_LIMITS.imagePrompt),
    postId: z.string().optional(),
    providerId: z.string().optional(),
  })
  .strict();
export const tokenScopeSchema = z.enum([
  "posts:read",
  "posts:write",
  "posts:publish",
  "media:write",
]);
export type TokenScope = z.infer<typeof tokenScopeSchema>;
export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(TEXT_LIMITS.tokenName),
    scopes: z.array(tokenScopeSchema).min(1).max(4),
    /** 省略时使用设置页“API 令牌默认有效期”；上限由设置页“最长有效期”在服务端再检查。 */
    expiresInDays: z.number().int().min(1).max(HARD_MAX_TOKEN_DAYS).optional(),
  })
  .strict();
export const tokenSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scopes: z.array(tokenScopeSchema),
    createdAt: z.string(),
    expiresAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .strict();
export type APIToken = z.infer<typeof tokenSchema>;
export const revisionSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string(),
    createdAt: z.string(),
    reason: z.enum(["save", "publish", "restore", "delete", "undelete"]),
  })
  .strict();
export type Revision = z.infer<typeof revisionSchema>;
export const capabilitiesSchema = z
  .object({
    authenticated: z.boolean(),
    aiConfigured: z.boolean(),
    imageConfigured: z.boolean(),
    passwordConfigured: z.boolean().optional(),
    storageConfigured: z.boolean(),
    ownerConfigured: z.boolean(),
  })
  .strict();
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export const bootstrapResponseSchema = z
  .object({
    posts: z.array(postSchema),
    settings: settingsSchema,
    capabilities: capabilitiesSchema,
  })
  .strict();
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
export const dashboardBootstrapSchema = bootstrapResponseSchema.extend({
  posts: z.array(postSummarySchema),
});
export type DashboardBootstrap = z.infer<typeof dashboardBootstrapSchema>;
export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type APIError = z.infer<typeof apiErrorSchema>;
export const postResponseSchema = z.object({ post: postSchema }).strict();
export const postsResponseSchema = z
  .object({ posts: z.array(postSchema) })
  .strict();
export const settingsResponseSchema = z
  .object({ settings: settingsSchema })
  .strict();
/** GET /api/deployment：部署配置只读状态，只有“是否已配置”，绝不含密钥值。 */
export const deploymentResponseSchema = z
  .object({
    deployment: z.array(
      z
        .object({
          key: z.string().max(40),
          label: z.string().max(80),
          configured: z.boolean(),
          note: z.string().max(80).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type DeploymentItemView = z.infer<
  typeof deploymentResponseSchema
>["deployment"][number];
export const mediaResponseSchema = z.object({ media: mediaSchema }).strict();
export const mediaListResponseSchema = z
  .object({ media: z.array(mediaSchema) })
  .strict();
export const aiResponseSchema = z.object({ text: z.string() }).strict();
export const modelsResponseSchema = z
  .object({ models: z.array(z.object({ id: z.string() }).strict()) })
  .strict();
export const tokensResponseSchema = z
  .object({ tokens: z.array(tokenSchema) })
  .strict();
export const tokenCreatedResponseSchema = tokenSchema
  .extend({ token: z.string().regex(OPAQUE_TOKEN_PATTERN) })
  .strict();
export const revisionsResponseSchema = z
  .object({ revisions: z.array(revisionSchema) })
  .strict();
export const unlockResponseSchema = z
  .object({ unlocked: z.literal(true) })
  .strict();
export const revokeTokenResponseSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export const identityResponseSchema = z
  .object({
    authenticated: z.boolean(),
    trustedIdentity: z.string().nullable(),
    ownerConfigured: z.boolean(),
  })
  .strict();
export const ackResponseSchema = z.union([
  unlockResponseSchema,
  revokeTokenResponseSchema,
]);
/** 上传界面与服务端共用 MIME 清单（来源：src/modules/config/limits.ts MEDIA_TYPES）；SVG/HTML 不在允许范围内。 */
export const acceptedMediaMimeTypes = MEDIA_MIME_LIST;
export type MediaUploadProblem = UploadProblem;
/**
 * 上传前检查：浏览器（编辑器、媒体库）与服务端 validateMedia 共用 src/modules/config 的 uploadProblem，
 * 大小上限与禁用类型来自设置页配置（未传入时为默认值）。
 */
export const mediaUploadProblem = uploadProblem;
