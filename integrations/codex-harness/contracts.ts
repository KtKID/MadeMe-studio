import { z } from "zod";
/** 客户端只提交业务意图；不允许选择命令、认证模式或宿主文件路径。 */
export const harnessTaskKindSchema = z.enum([
  "polish-selection",
  "image-generation",
]);
export const harnessModelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
export const harnessApiKeySchema = z
  .object({
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^\S+$/),
  })
  .strict();
export const harnessTaskInputSchema = z
  .object({
    requestId: z.uuid(),
    kind: harnessTaskKindSchema,
    input: z.string().trim().min(1).max(20_000),
    mode: z.enum(["replay", "record"]).default("replay"),
    model: harnessModelSchema,
    recordConsent: z.boolean().default(false),
  })
  .strict()
  .refine((value) => value.mode !== "record" || value.recordConsent, {
    message: "录制前必须明确确认可能产生费用。",
  });
export const harnessEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text-delta"),
      text: z.string().max(200_000),
      seq: z.number().int().nonnegative(),
      elapsedMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("state"),
      status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
      seq: z.number().int().nonnegative(),
      elapsedMs: z.number().nonnegative(),
    })
    .strict(),
]);
export type HarnessEvent = z.infer<typeof harnessEventSchema>;
export const harnessErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .strict();
export const harnessStatusSchema = z
  .object({
    connected: z.boolean(),
    authenticated: z.boolean(),
    authMode: z.enum(["none", "chatgpt", "apiKey"]),
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
    mode: z.enum(["replay", "record"]),
    model: harnessModelSchema,
    events: z.array(harnessEventSchema).max(1000).default([]),
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
