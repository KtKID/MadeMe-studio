import { z } from "zod";
import { identityResponseSchema } from "../../shared/contracts";
export const studioHistorySchema = z
  .object({ session: z.string(), index: z.number().int().nonnegative() })
  .strict();
export type StudioHistoryEntry = z.infer<typeof studioHistorySchema>;
/** 只记录本document的历史位置，不保存文章/设置/身份数据。 */
export class StudioHistory {
  index = 0;
  locked = false;
  constructor(readonly session: string) {}
  entry(): StudioHistoryEntry {
    return { session: this.session, index: this.index };
  }
  push() {
    if (this.locked) throw new Error("历史恢复中不能追加导航");
    this.index += 1;
    return this.entry();
  }
  pop(
    raw: unknown,
    accepted: boolean,
  ):
    | { kind: "external" | "accept" | "compensated" }
    | { kind: "restore"; delta: number } {
    const parsed = studioHistorySchema.safeParse(raw);
    if (!parsed.success || parsed.data.session !== this.session)
      return { kind: "external" };
    const next = parsed.data.index;
    if (this.locked) {
      if (next === this.index) {
        this.locked = false;
        return { kind: "compensated" };
      }
      return { kind: "restore", delta: this.index - next };
    }
    if (!accepted && next !== this.index) {
      this.locked = true;
      return { kind: "restore", delta: this.index - next };
    }
    this.index = next;
    return { kind: "accept" };
  }
}
export function sameIdentity(trustedIdentity: string | null, value: unknown) {
  const parsed = identityResponseSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.authenticated &&
    parsed.data.trustedIdentity === trustedIdentity
  );
}
