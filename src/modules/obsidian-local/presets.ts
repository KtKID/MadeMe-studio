import { OBSIDIAN_LOCAL_DEFAULTS } from "../config/limits";
import {
  presetRecordSchema,
  presetSchema,
  type DirectoryHandle,
  type Preset,
  type PresetRecord,
} from "./contracts";
export type {
  DirectoryHandle,
  LocalFileHandle,
  Preset,
  PresetRecord,
} from "./contracts";

export {
  isDirectoryPickerSupported,
  pickDirectory,
  verifyVault,
} from "./directory";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new Error("IndexedDB 不可用，无法保存本浏览器的目录授权预设。"),
    );
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      OBSIDIAN_LOCAL_DEFAULTS.databaseName,
      OBSIDIAN_LOCAL_DEFAULTS.databaseVersion,
    );
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBSIDIAN_LOCAL_DEFAULTS.presetStore)) {
        db.createObjectStore(OBSIDIAN_LOCAL_DEFAULTS.presetStore, {
          keyPath: "preset.id",
        });
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地预设数据库。"));
    request.onblocked = () =>
      reject(new Error("本地预设数据库正在升级，请关闭其他本站标签页后重试。"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
/** 必须等事务提交才报告成功；不能仅等 put 请求返回。 */
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(OBSIDIAN_LOCAL_DEFAULTS.presetStore, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("本地预设保存事务已取消。"));
      tx.onerror = () => reject(tx.error ?? new Error("本地预设读写失败。"));
      const request = operation(
        tx.objectStore(OBSIDIAN_LOCAL_DEFAULTS.presetStore),
      );
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () =>
        reject(request.error ?? new Error("本地预设读写失败。"));
    });
  } finally {
    db.close();
  }
}
export async function listPresets(): Promise<PresetRecord[]> {
  const records = await transaction<unknown[]>("readonly", (store) =>
    store.getAll(),
  );
  return records.map((record) => presetRecordSchema.parse(record));
}
export async function putPreset(
  preset: Preset,
  handle: DirectoryHandle,
): Promise<void> {
  const record = presetRecordSchema.parse({ preset, handle });
  await transaction("readwrite", (store) => store.put(record));
}
export async function deletePreset(id: string): Promise<void> {
  const validId = presetSchema.shape.id.parse(id);
  await transaction("readwrite", (store) => store.delete(validId));
}
