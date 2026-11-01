import { z } from "zod";
import { postSchema, type Post } from "../../shared/contracts";
import { clientCaught } from "../../modules/log/client";
const prefix = "mademe:editor-recovery:";
const recoverySchema = z.object({
  id: z.string(),
  savedAt: z.string(),
  base: postSchema,
  local: postSchema,
});
export type LocalRecovery = z.infer<typeof recoverySchema>;
type RecoveryStorage = Pick<Storage, "length" | "key" | "setItem" | "getItem">;
/** 每次保存新键，不覆盖旧副本；读回核实成功后才允许替换输入。配额失败由UI阻止加载。 */
export function saveRecovery(
  storage: RecoveryStorage,
  base: Post,
  local: Post,
): LocalRecovery {
  const record = recoverySchema.parse({
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    base,
    local,
  });
  const key = prefix + base.id + ":" + record.id,
    value = JSON.stringify(record);
  storage.setItem(key, value);
  if (storage.getItem(key) !== value)
    throw new Error("本地副本未能写入，请检查浏览器存储空间或权限。");
  return record;
}
export function listRecoveries(
  storage: RecoveryStorage,
  postId: string,
): LocalRecovery[] {
  const copies: LocalRecovery[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix + postId + ":")) continue;
    try {
      const value = recoverySchema.parse(JSON.parse(storage.getItem(key)!));
      if (value.base.id !== postId || value.local.id !== postId)
        throw new Error("副本文章标识不一致");
      copies.push(value);
    } catch (error) {
      clientCaught("editor.recovery_invalid", error);
    }
  }
  return copies.reverse().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function latestRecovery(
  storage: RecoveryStorage,
  postId: string,
): LocalRecovery | null {
  return listRecoveries(storage, postId)[0] ?? null;
}
