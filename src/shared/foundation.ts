import { z } from "zod";

// 健康检查也使用协议校验，避免前后端各自定义响应结构。
export const healthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("MadeMe Studio"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();
export type HealthResponse = z.infer<typeof healthSchema>;
