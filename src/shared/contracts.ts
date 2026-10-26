import { z } from "zod";

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
    text: z.string().max(1_000_000),
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
  z.string().max(1_000_000),
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
  title: z.string().trim().min(1).max(240),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(160),
  excerpt: z.string().max(1000),
  blocks: blocksSchema,
  category: z.string().trim().max(100),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
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
    markdown: z.string().max(1_000_000).optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .strict();
export const patchPostSchema = editablePostSchema
  .partial()
  .extend({
    version: z.number().int().positive(),
    password: z.string().min(8).max(128).optional(),
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
    password: z.string().min(8).max(128).optional(),
  })
  .strict();
export const unlockInputSchema = z
  .object({ password: z.string().max(128) })
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
  name: z.string().min(1).max(80),
  kind: z.enum(["openai", "openrouter", "siliconflow", "cloudflare", "gemini"]),
  model: z.string().min(1).max(160),
  imageModel: z.string().trim().min(1).max(160).optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(16).max(16384).default(2048),
  configured: z.boolean().default(false),
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
  siteTitle: z.string().trim().min(1).max(80),
  tagline: z.string().max(240),
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
        label: z.string().min(1).max(40),
        href: z
          .string()
          .max(2048)
          .refine(
            (v) => /^\/(?!\/)/.test(v) || /^https:\/\//i.test(v),
            "Use a root-relative or HTTPS URL",
          ),
      }),
    )
    .max(12),
  prompts: z.array(promptSchema).max(40),
  providers: z.array(providerSchema).max(12),
  customCode: z.string().max(20000),
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
    selection: z.string().min(1).max(40000),
    postId: z.string().optional(),
    promptId: z.string().optional(),
    providerId: z.string().optional(),
    language: z.string().max(60).optional(),
  })
  .strict();
export const imageInputSchema = z
  .object({
    prompt: z.string().min(1).max(4000),
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
    name: z.string().trim().min(1).max(80),
    scopes: z.array(tokenScopeSchema).min(1).max(4),
    expiresInDays: z.number().int().min(1).max(365).default(90),
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
  .extend({ token: z.string().regex(/^mm_[a-f0-9]{64}$/) })
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
/** 上传界面与服务端共用 MIME 清单；SVG/HTML 不在允许范围内。 */
export const acceptedMediaMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/epub+zip",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;
