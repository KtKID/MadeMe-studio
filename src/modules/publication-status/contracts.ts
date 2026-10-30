import { z } from "zod";

/** 只读派生状态，不能通过文章创建/更新协议写入。 */
export const publicationStatusSchema = z.object({
  hasUnpublishedChanges: z.boolean().optional(),
  publishedVisibility: z
    .enum(["public", "unlisted", "password"])
    .nullable()
    .optional(),
});
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;
