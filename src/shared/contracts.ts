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
export const blocksSchema = z
  .array(z.record(z.string(), jsonValueSchema))
  .max(2000);
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
  kind: z.enum(["openai", "openrouter", "siliconflow", "cloudflare"]),
  model: z.string().min(1).max(160),
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
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
  .extend({ mode: modeSchema.optional(), skin: skinSchema.optional() })
  .strict();
export const defaultSettings: Settings = {
  siteTitle: "MadeMe",
  tagline: "A quiet place for ideas that matter.",
  theme: "paper",
  mode: "system",
  skin: "amber",
  accent: "#d4a72c",
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
export type APIToken = {
  id: string;
  name: string;
  scopes: TokenScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};
export type Revision = {
  version: number;
  title: string;
  createdAt: string;
  reason: "save" | "publish" | "restore" | "delete" | "undelete";
};
export type Capabilities = {
  authenticated: boolean;
  aiConfigured: boolean;
  imageConfigured: boolean;
  storageConfigured: boolean;
  ownerConfigured: boolean;
};
export type BootstrapResponse = {
  posts: Post[];
  settings: Settings;
  capabilities: Capabilities;
};
export type APIError = {
  error: { code: string; message: string; details?: unknown };
};
