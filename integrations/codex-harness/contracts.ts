import { z } from "zod";
/** 客户端只提交业务意图；不允许选择命令、认证模式或宿主文件路径。 */
export const harnessTaskKindSchema = z.enum([
  "polish-selection",
  "image-generation",
]);
export const harnessTaskInputSchema = z
  .object({
    requestId: z.uuid(),
    kind: harnessTaskKindSchema,
    input: z.string().trim().min(1).max(20_000),
  })
  .strict();
export const harnessErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .strict();
export const harnessStatusSchema = z
  .object({
    connected: z.boolean(),
    authenticated: z.boolean(),
    browserLoginAvailable: z.boolean(),
    loginStatus: z.enum(["idle", "pending", "failed"]).optional(),
    loginError: z.string().optional(),
    capabilities: z
      .object({ polishSelection: z.boolean(), imageGeneration: z.boolean() })
      .strict(),
  })
  .strict();
export const harnessLoginSchema = z
  .object({
    loginId: z.string().min(1).max(200),
    authUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        ["auth.openai.com", "chatgpt.com"].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port
      );
    }, "仅支持官方 HTTPS 网页登录地址"),
  })
  .strict();
export const harnessLoginCancelSchema = z
  .object({ loginId: z.string().min(1).max(200) })
  .strict();
export const harnessTaskSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    kind: harnessTaskKindSchema,
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    result: z
      .object({
        text: z.string().max(200_000).optional(),
        artifactId: z.uuid().optional(),
      })
      .strict()
      .optional(),
    error: harnessErrorSchema.optional(),
  })
  .strict();
export const harnessAckSchema = z.object({ ok: z.literal(true) }).strict();
export type HarnessTaskInput = z.infer<typeof harnessTaskInputSchema>;
export type HarnessTask = z.infer<typeof harnessTaskSchema>;
export type HarnessStatus = z.infer<typeof harnessStatusSchema>;
export type HarnessLogin = z.infer<typeof harnessLoginSchema>;
