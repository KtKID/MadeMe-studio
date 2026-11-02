import { clientLog } from "../log/client";
import { z } from "zod";
import { OBSIDIAN_REPOSITORY_LOCAL as LOCAL } from "../config/limits";
import {
  directoryHandleSchema,
  type DirectoryHandle,
} from "../obsidian-local/contracts";
import { verifyVault } from "../obsidian-local/directory";

export const repositoryConnectionSchema = z
  .object({
    id: z.literal(LOCAL.key),
    revision: z.uuid(),
    name: z.string().min(1),
    handle: directoryHandleSchema,
  })
  .strict();
export type RepositoryConnection = z.infer<typeof repositoryConnectionSchema>;
export type RepositoryRoot = Pick<RepositoryConnection, "name" | "handle">;

export class RepositoryReadPermissionError extends Error {
  constructor(readonly state: PermissionState) {
    super(
      state === "denied"
        ? "Obsidian 仓库读取权限被拒绝，请重新授权读取；不会请求写权限。"
        : "Obsidian 仓库需要重新授权读取，当前正文未改变。",
    );
    this.name = "RepositoryReadPermissionError";
  }
}
export async function checkRepositoryRead(root: RepositoryRoot) {
  const state =
    (await root.handle.queryPermission?.({ mode: "read" })) ?? "prompt";
  if (state !== "granted") throw new RepositoryReadPermissionError(state);
  if (!(await verifyVault(root.handle)))
    throw new Error(
      "连接的目录找不到 .obsidian，请在 Obsidian 仓库设置重新选择；当前正文未改变。",
    );
}
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new Error("IndexedDB 不可用，无法保存此浏览器的仓库连接。"),
    );
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL.databaseName, LOCAL.databaseVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LOCAL.store))
        request.result.createObjectStore(LOCAL.store, { keyPath: "id" });
    };
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开仓库连接。"));
    request.onblocked = () =>
      reject(new Error("仓库连接存储被其他标签页阻塞，请关闭旧页面后重试。"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(LOCAL.store, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(tx.error ?? new Error("仓库连接存储未提交，原连接保留。"));
      tx.onerror = () => reject(tx.error ?? new Error("仓库连接存储失败。"));
      const request = operation(tx.objectStore(LOCAL.store));
      request.onsuccess = () => {
        value = request.result;
      };
      request.onerror = () =>
        reject(request.error ?? new Error("仓库连接读写失败。"));
    });
  } finally {
    db.close();
  }
}
/** 只访问独立存储，不查询、复制或迁移笔记导出预设。 */
export async function getRepository(): Promise<
  RepositoryConnection | undefined
> {
  const value = await transaction<unknown>("readonly", (store) =>
    store.get(LOCAL.key),
  );
  return value === undefined
    ? undefined
    : repositoryConnectionSchema.parse(value);
}
/** 只用于明确选择/替换后的目录句柄，原连接在校验或事务失败时保留。 */
export async function setRepository(
  handle: DirectoryHandle,
): Promise<RepositoryConnection> {
  await checkRepositoryRead({ name: handle.name, handle });
  const connection = repositoryConnectionSchema.parse({
    id: LOCAL.key,
    revision: crypto.randomUUID(),
    name: handle.name,
    handle,
  });
  await transaction("readwrite", (store) => store.put(connection));
  notifyRepositoryChange();
  return connection;
}
export async function clearRepository(): Promise<void> {
  await transaction("readwrite", (store) => store.delete(LOCAL.key));
  notifyRepositoryChange();
}
export async function assertRepositoryCurrent(
  connection: RepositoryConnection,
) {
  const current = await getRepository();
  if (!current || current.revision !== connection.revision)
    throw new Error(
      "Obsidian 仓库连接已更换或清除，请重新选择文章；当前正文未改变。",
    );
}
/** 用户明确点击重新授权才请求read，既不申请写权限也不写入预设。 */
export async function authorizeRepositoryRead(
  connection: RepositoryConnection,
) {
  await assertRepositoryCurrent(connection);
  if (!connection.handle.requestPermission)
    throw new Error("浏览器无法恢复此授权，请重新选择 Obsidian 仓库目录。");
  const state = await connection.handle.requestPermission({ mode: "read" });
  if (state !== "granted") throw new RepositoryReadPermissionError(state);
  await assertRepositoryCurrent(connection);
}

/** 通知只传变化事件，不传句柄或路径；通道不可用时版本校验仍有效。 */
function changeChannel(): BroadcastChannel | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.BroadcastChannel !== "function"
  )
    return undefined;
  try {
    return new window.BroadcastChannel(LOCAL.changeEvent);
  } catch (error) {
    logChannelFailure(error);
    return undefined;
  }
}
function logChannelFailure(error: unknown) {
  clientLog("warn", "obsidian_repository.change_channel_unavailable", {
    reason: error instanceof DOMException ? error.name : "operation_failed",
  });
}
function notifyRepositoryChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL.changeEvent));
  const channel = changeChannel();
  try {
    channel?.postMessage("changed");
  } catch (error) {
    logChannelFailure(error);
  } finally {
    channel?.close();
  }
}
export function subscribeRepositoryChanges(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LOCAL.changeEvent, listener);
  const channel = changeChannel();
  channel?.addEventListener("message", listener);
  return () => {
    window.removeEventListener(LOCAL.changeEvent, listener);
    channel?.close();
  };
}
