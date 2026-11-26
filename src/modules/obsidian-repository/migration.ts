import { z } from "zod";
import { clientLog } from "../log/client";
import {
  OBSIDIAN_LOCAL_DEFAULTS,
  OBSIDIAN_REPOSITORY_LOCAL,
} from "../config/limits";
import {
  presetRecordSchema,
  directoryHandleSchema,
  type DirectoryHandle,
  type PresetRecord,
} from "../obsidian-local/contracts";
import {
  repositorySchema,
  repositoryPresetSchema,
  type Workspace,
} from "./models";
import {
  closeIndexedDb,
  indexedDatabaseExists,
  tryDeleteIndexedDatabase,
  withIndexedDbTimeout,
} from "./idb";
const oldConnectionSchema = z
  .object({
    id: z.literal(OBSIDIAN_REPOSITORY_LOCAL.key),
    revision: z.uuid(),
    name: z.string().min(1),
    handle: directoryHandleSchema,
  })
  .strict();
export type LegacyConnection = z.infer<typeof oldConnectionSchema>;
/** 不读取正文/标记，不申请权限；只能true证明同根，undefined必须分开保留。 */
export async function sameDirectory(
  a: DirectoryHandle,
  b: DirectoryHandle,
): Promise<boolean | undefined> {
  if (a === b) return true;
  const handle = a.isSameEntry ? a : b,
    other = a.isSameEntry ? b : a;
  if (!handle.isSameEntry) return undefined;
  try {
    return await handle.isSameEntry(other);
  } catch (error) {
    clientLog("warn", "obsidian_repository.identity_pending", {
      reason: error instanceof DOMException ? error.name : "operation_failed",
    });
    return undefined;
  }
}
async function hasRead(handle: DirectoryHandle) {
  try {
    return (await handle.queryPermission?.({ mode: "read" })) === "granted";
  } catch (error) {
    clientLog("warn", "obsidian_repository.migration_permission_pending", {
      reason: error instanceof DOMException ? error.name : "operation_failed",
    });
    return false;
  }
}
/** 纯计划，失败时不写任一旧库/新库；不按名称合并，不丢失未知身份的根。 */
export async function planLegacyMigration(
  records: PresetRecord[],
  connection?: LegacyConnection,
): Promise<Workspace> {
  const result: Workspace = { repositories: [], presets: [] };
  const sources = [
    ...(connection
      ? [{ name: connection.name, handle: connection.handle, isVault: true }]
      : []),
    ...records.map((record) => ({
      name: record.preset.vaultName,
      handle: record.handle,
      isVault: record.preset.isVault,
      preset: record.preset,
    })),
  ];
  for (const source of sources) {
    let matched: Workspace["repositories"][number] | undefined,
      uncertain = false;
    for (const repository of result.repositories) {
      const same = await sameDirectory(repository.handle, source.handle);
      if (same === true) {
        matched = repository;
        break;
      }
      if (same === undefined) {
        repository.identity = "pending";
        uncertain = true;
      }
    }
    if (!matched) {
      matched = repositorySchema.parse({
        id: crypto.randomUUID(),
        revision: crypto.randomUUID(),
        name: source.name,
        handle: source.handle,
        identity:
          !uncertain && (await hasRead(source.handle))
            ? "confirmed"
            : "pending",
        isVault: source.isVault,
      });
      result.repositories.push(matched);
    }
    matched.isVault = matched.isVault || source.isVault;
    if ("preset" in source && source.preset) {
      const preset = source.preset;
      result.presets.push(
        repositoryPresetSchema.parse({
          id: crypto.randomUUID(),
          revision: crypto.randomUUID(),
          repositoryId: matched.id,
          name: preset.name,
          noteDirectory: preset.noteDirectory,
          imageRule: preset.imageRule,
        }),
      );
    }
  }
  return result;
}
/** 只读既有v1库。不存在时不 abort 升级事务（部分浏览器会因此既不成功也不失败）。 */
async function readLegacy(name: string, storeName: string): Promise<unknown[]> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("IndexedDB不可用，原配置未改变。"));
  const exists = await indexedDatabaseExists(name);
  if (exists === false) return [];
  return openLegacy(name, storeName);
}
function openLegacy(name: string, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let created = false,
      settled = false;
    const finish = (error?: Error, rows?: unknown[]) => {
      if (settled) {
        closeIndexedDb(request.result);
        return;
      }
      settled = true;
      if (error) {
        closeIndexedDb(request.result);
        reject(error);
      } else resolve(rows ?? []);
    };
    const work = new Promise<unknown[]>((innerResolve, innerReject) => {
      const done = (error?: Error, rows?: unknown[]) =>
        error ? innerReject(error) : innerResolve(rows ?? []);
      request.onupgradeneeded = () => {
        created = true;
      };
      request.onerror = () =>
        done(request.error ?? new Error("旧配置读取失败，尚未迁移。"));
      request.onblocked = () =>
        done(new Error("旧配置读取被其他标签页阻塞，请关闭旧页面后重试。"));
      request.onsuccess = () => {
        const db = request.result;
        const absent =
          created ||
          (!db.objectStoreNames.contains(storeName) &&
            db.objectStoreNames.length === 0);
        if (absent) {
          closeIndexedDb(db);
          void tryDeleteIndexedDatabase(name).finally(() =>
            done(undefined, []),
          );
          return;
        }
        if (!db.objectStoreNames.contains(storeName)) {
          closeIndexedDb(db);
          done(new Error("旧配置结构不符合已知版本，未迁移或删除。"));
          return;
        }
        const tx = db.transaction(storeName, "readonly"),
          read = tx.objectStore(storeName).getAll();
        let rows: unknown[] = [];
        read.onsuccess = () => {
          rows = read.result;
        };
        tx.oncomplete = () => {
          closeIndexedDb(db);
          done(undefined, rows);
        };
        tx.onabort = () => {
          closeIndexedDb(db);
          done(tx.error ?? new Error("旧配置读取中止。"));
        };
        tx.onerror = () => {
          closeIndexedDb(db);
          done(tx.error ?? new Error("旧配置读取失败。"));
        };
      };
    });
    void withIndexedDbTimeout(
      "旧配置读取超时，请关闭其他本站标签页后重试。",
      work,
      request,
    ).then(
      (rows) => finish(undefined, rows),
      (error) =>
        finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
export async function legacyMigrationPlan() {
  const [presets, connections] = await Promise.all([
    readLegacy(
      OBSIDIAN_LOCAL_DEFAULTS.databaseName,
      OBSIDIAN_LOCAL_DEFAULTS.presetStore,
    ),
    readLegacy(
      OBSIDIAN_REPOSITORY_LOCAL.databaseName,
      OBSIDIAN_REPOSITORY_LOCAL.store,
    ),
  ]);
  if (connections.length > 1)
    throw new Error("旧单仓库连接数量异常，原配置保留，请先核对。 ");
  return planLegacyMigration(
    presets.map((row) => presetRecordSchema.parse(row)),
    connections[0] === undefined
      ? undefined
      : oldConnectionSchema.parse(connections[0]),
  );
}
