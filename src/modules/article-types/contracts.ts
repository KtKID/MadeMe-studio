/** 文章类型共享协议：稳定 ID 与显示名称分离，旧 category 文本不做破坏性迁移。 */
import { z } from "zod";
import { TEXT_LIMITS, ARTICLE_TYPE_LIMIT } from "../config/limits.ts";
export { ARTICLE_TYPE_LIMIT } from "../config/limits.ts";
export const articleTypeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const articleTypeNameSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1, "请输入类型名称")
      .max(TEXT_LIMITS.category, "类型名称过长"),
  );
export function articleTypeNameKey(name: string) {
  return name.normalize("NFC").trim().toLocaleLowerCase("zh-CN");
}
export const articleTypeSchema = z
  .object({
    id: articleTypeIdSchema,
    name: articleTypeNameSchema,
    legacyNames: z
      .array(articleTypeNameSchema)
      .max(ARTICLE_TYPE_LIMIT)
      .optional(),
  })
  .strict();
export type ArticleType = z.infer<typeof articleTypeSchema>;
export const DEFAULT_ARTICLE_TYPES: ArticleType[] = [
  { id: "ai", name: "AI" },
  { id: "reflection", name: "感悟" },
];
export const articleTypeListSchema = z
  .array(articleTypeSchema)
  .max(ARTICLE_TYPE_LIMIT)
  .superRefine((types, ctx) => {
    const names = new Map<string, string>();
    let duplicate = new Set(types.map((t) => t.id)).size !== types.length;
    for (const type of types)
      for (const name of [type.name, ...(type.legacyNames ?? [])]) {
        const key = articleTypeNameKey(name);
        if (names.has(key) && names.get(key) !== type.id) duplicate = true;
        names.set(key, type.id);
      }
    if (duplicate)
      ctx.addIssue({ code: "custom", message: "类型 ID 和名称不能重复" });
  });
export const articleTypeMutationSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), name: articleTypeNameSchema })
    .strict(),
  z
    .object({
      action: z.literal("rename"),
      id: articleTypeIdSchema,
      name: articleTypeNameSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: articleTypeIdSchema }).strict(),
]);
export type ArticleTypeMutation = z.infer<typeof articleTypeMutationSchema>;
export const articleTypesResponseSchema = z
  .object({
    types: articleTypeListSchema,
    selectedId: articleTypeIdSchema.optional(),
  })
  .strict();
/** 响应别名供客户端统一路由校验使用。 */
export const typesResponseSchema = articleTypesResponseSchema;
export type ArticleTypesResponse = z.infer<typeof articleTypesResponseSchema>;
