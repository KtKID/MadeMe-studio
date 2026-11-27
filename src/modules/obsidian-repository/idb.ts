import { OBSIDIAN_WORKSPACE_LOCAL } from "../config/limits";

/** 打开、列举或事务的上限；超时必须失败，避免设置页一直转圈。 */
const DEFAULT_TIMEOUT_MS = OBSIDIAN_WORKSPACE_LOCAL.indexedDbTimeoutMs;
let openTimeoutMs: number = DEFAULT_TIMEOUT_MS;
export function setIndexedDbOpenTimeoutForTests(ms?: number) {
  openTimeoutMs = ms === undefined ? DEFAULT_TIMEOUT_MS : ms;
}
export function closeIndexedDb(db?: IDBDatabase | null) {
  try {
    db?.close();
  } catch {
    /* 关闭失败不改变原数据，调用方仍按超时或错误处理。 */
  }
}
export async function listIndexedDatabases(): Promise<
  IDBDatabaseInfo[] | undefined
> {
  if (
    typeof indexedDB === "undefined" ||
    typeof indexedDB.databases !== "function"
  )
    return undefined;
  return await withIndexedDbTimeout(
    "无法确认本机配置库是否存在，请关闭其他本站标签页后重试。",
    indexedDB.databases(),
  );
}
export async function indexedDatabaseExists(
  name: string,
): Promise<boolean | undefined> {
  const list = await listIndexedDatabases();
  if (!list) return undefined;
  return list.some((database) => database.name === name);
}
export function withIndexedDbTimeout<T>(
  message: string,
  operation: Promise<T>,
  request?: IDBOpenDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(message));
    }, openTimeoutMs);
    const finish = (error?: Error, value?: T) => {
      if (settled) {
        closeIndexedDb(request?.result);
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        closeIndexedDb(request?.result);
        reject(error);
      } else resolve(value as T);
    };
    operation.then(
      (value) => finish(undefined, value),
      (error) =>
        finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
export async function tryDeleteIndexedDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const request = indexedDB.deleteDatabase(name);
  try {
    await withIndexedDbTimeout(
      "清理误建的空配置库超时，已按无旧配置继续。",
      new Promise<void>((resolve) => {
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
      request,
    );
  } catch {
    /* 删除超时不阻塞“无旧配置”路径。 */
  }
}
