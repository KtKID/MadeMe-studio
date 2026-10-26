import { z } from "zod";
/** 上游响应只解析业务需要的字段，不将任意上游对象透传到客户端。 */
export const chatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .optional(),
});
const geminiPartSchema = z.object({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
});
export const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(geminiPartSchema) }).optional(),
      }),
    )
    .optional(),
});
export const imageResponseSchema = z.object({
  data: z
    .array(
      z.object({ b64_json: z.string(), media_type: z.string().optional() }),
    )
    .min(1),
});
export const siliconImageSchema = z.object({
  images: z.array(z.object({ url: z.string().max(8000) })).min(1),
});
export const cloudflareImageSchema = z.object({
  success: z.boolean().optional(),
  result: z.object({ image: z.string() }).optional(),
  image: z.string().optional(),
});
export const standardModelsSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});
export const geminiModelsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
  nextPageToken: z.string().optional(),
});
export const cloudflareModelsSchema = z.object({
  success: z.boolean().optional(),
  result: z.array(
    z.object({ name: z.string().optional(), id: z.string().optional() }),
  ),
});
