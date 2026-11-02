import { OBSIDIAN_WORKSPACE_LOCAL as LOCAL } from "../config/limits";
import { legacyMigrationPlan, sameDirectory } from "./migration";
import {
  repositorySchema,
  repositoryPresetSchema,
  type Repository,
  type RepositoryPreset,
  type Workspace,
} from "./models";
import type { DirectoryHandle } from "../obsidian-local/contracts";

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    throw new Error("IndexedDB不可用，无法读取仓库与预设。 ");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL.databaseName, LOCAL.databaseVersion);
    request.onupgradeneeded = () => {
      for (const name of [LOCAL.repositories, LOCAL.presets, LOCAL.meta])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onerror = () =>
      reject(request.error ?? new Error("仓库配置打开失败。"));
    request.onblocked = () =>
      reject(new Error("仓库配置被旧页面阻塞，请关闭其他本站标签页。"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
/** callback只能同步排入IDB请求，异步目录比较在事务外规划。 */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (
    tx: IDBTransaction,
    set: (value: T) => void,
    guard: (fn: () => void) => () => void,
  ) => void,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T, reason: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(
          reason ?? tx.error ?? new Error("仓库配置事务未提交，原数据保留。"),
        );
      tx.onerror = () => {
        reason ??= tx.error;
      };
      const fail = (error: unknown) => {
        reason = error;
        try {
          tx.abort();
        } catch {
          reject(error);
        }
      };
      const guard = (fn: () => void) => () => {
        try {
          fn();
        } catch (error) {
          fail(error);
        }
      };
      try {
        operation(
          tx,
          (next) => {
            value = next;
          },
          guard,
        );
      } catch (error) {
        fail(error);
      }
    });
  } finally {
    db.close();
  }
}
async function migrated() {
  return transact<boolean>([LOCAL.meta], "readonly", (tx, set, guard) => {
    const read = tx.objectStore(LOCAL.meta).get(LOCAL.migrationKey);
    read.onsuccess = guard(() => set(read.result?.complete === true));
  });
}
let migrating: Promise<void> | undefined;
export function ensureMigration(): Promise<void> {
  if (migrating) return migrating;
  migrating = (async () => {
    if (await migrated()) return;
    const plan = await legacyMigrationPlan();
    await transact<void>(
      [LOCAL.repositories, LOCAL.presets, LOCAL.meta],
      "readwrite",
      (tx, set, guard) => {
        const meta = tx.objectStore(LOCAL.meta),
          read = meta.get(LOCAL.migrationKey);
        read.onsuccess = guard(() => {
          if (read.result?.complete === true) {
            set(undefined);
            return;
          }
          const roots = tx.objectStore(LOCAL.repositories),
            rules = tx.objectStore(LOCAL.presets);
          const oldRoots = roots.count(),
            oldRules = rules.count();
          let completed = 0;
          const commit = guard(() => {
            if (++completed !== 2) return;
            if (oldRoots.result || oldRules.result)
              throw new Error(
                "规范化配置已存在但迁移标记缺失，原数据保留，请核对。 ",
              );
            for (const repository of plan.repositories) roots.put(repository);
            for (const preset of plan.presets) rules.put(preset);
            meta.put({
              id: LOCAL.migrationKey,
              complete: true,
              repositories: plan.repositories.length,
              presets: plan.presets.length,
            });
            set(undefined);
          });
          oldRoots.onsuccess = commit;
          oldRules.onsuccess = commit;
        });
      },
    );
  })().finally(() => {
    migrating = undefined;
  });
  return migrating;
}
export async function listWorkspace(): Promise<Workspace> {
  await ensureMigration();
  return transact<Workspace>(
    [LOCAL.repositories, LOCAL.presets],
    "readonly",
    (tx, set, guard) => {
      const roots = tx.objectStore(LOCAL.repositories).getAll(),
        rules = tx.objectStore(LOCAL.presets).getAll();
      let completed = 0;
      const finish = guard(() => {
        if (++completed !== 2) return;
        const repositories = roots.result.map((row) =>
            repositorySchema.parse(row),
          ),
          presets = rules.result.map((row) =>
            repositoryPresetSchema.parse(row),
          );
        if (
          presets.some(
            (p) => !repositories.some((r) => r.id === p.repositoryId),
          )
        )
          throw new Error("发现无所属仓库的预设，配置保留，请核对。 ");
        set({ repositories, presets });
      });
      roots.onsuccess = finish;
      rules.onsuccess = finish;
    },
  );
}
/** 根查询不读取/校验预设，导入不依赖子配置的存在或生命周期。 */
export async function listRepositories(): Promise<Repository[]> {
  await ensureMigration();
  return transact<Repository[]>(
    [LOCAL.repositories],
    "readonly",
    (tx, set, guard) => {
      const read = tx.objectStore(LOCAL.repositories).getAll();
      read.onsuccess = guard(() =>
        set(read.result.map((row) => repositorySchema.parse(row))),
      );
    },
  );
}
export async function getRepository(
  id: string,
): Promise<Repository | undefined> {
  await ensureMigration();
  return transact<Repository | undefined>(
    [LOCAL.repositories],
    "readonly",
    (tx, set, guard) => {
      const read = tx.objectStore(LOCAL.repositories).get(id);
      read.onsuccess = guard(() =>
        set(
          read.result === undefined
            ? undefined
            : repositorySchema.parse(read.result),
        ),
      );
    },
  );
}
/** 新增前仅true能证明已存在；未知身份保留为单独待确认根。 */
export async function insertRepository(
  handle: DirectoryHandle,
): Promise<Repository> {
  const repositories = await listRepositories();
  let pending = false;
  for (const repository of repositories) {
    const same = await sameDirectory(repository.handle, handle);
    if (same === true)
      throw new Error("这个目录已在仓库列表中，请使用已有仓库。 ");
    if (same === undefined) pending = true;
  }
  const repository = repositorySchema.parse({
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    name: handle.name,
    handle,
    isVault: true,
    identity: pending ? "pending" : "confirmed",
  });
  await transact<void>([LOCAL.repositories], "readwrite", (tx, set, guard) => {
    const roots = tx.objectStore(LOCAL.repositories),
      read = roots.getAll();
    read.onsuccess = guard(() => {
      const signature = (rows: Repository[]) =>
        JSON.stringify(
          rows
            .map((row) => [row.id, row.revision])
            .sort((a, b) => a[0].localeCompare(b[0])),
        );
      const current = read.result.map((row) => repositorySchema.parse(row));
      if (signature(current) !== signature(repositories))
        throw new Error("仓库列表已变化，本次未新增，请重新核对后添加。 ");
      roots.add(repository);
      set(undefined);
    });
  });
  return repository;
}
export async function confirmRepository(id: string, revision: string) {
  await ensureMigration();
  return transact<Repository>(
    [LOCAL.repositories],
    "readwrite",
    (tx, set, guard) => {
      const store = tx.objectStore(LOCAL.repositories),
        read = store.get(id);
      read.onsuccess = guard(() => {
        const row = repositorySchema.parse(read.result);
        if (row.revision !== revision)
          throw new Error("仓库已变化，请重新确认。 ");
        const next = repositorySchema.parse({
          ...row,
          identity: "confirmed",
          isVault: true,
          revision: crypto.randomUUID(),
        });
        store.put(next);
        set(next);
      });
    },
  );
}
export async function savePreset(
  input: Omit<RepositoryPreset, "revision">,
  expectedRevision?: string,
) {
  await ensureMigration();
  const next = repositoryPresetSchema.parse({
    ...input,
    revision: crypto.randomUUID(),
  });
  return transact<RepositoryPreset>(
    [LOCAL.repositories, LOCAL.presets],
    "readwrite",
    (tx, set, guard) => {
      const roots = tx.objectStore(LOCAL.repositories),
        rules = tx.objectStore(LOCAL.presets),
        readRoot = roots.get(next.repositoryId);
      readRoot.onsuccess = guard(() => {
        if (!readRoot.result) throw new Error("所属仓库已删除，预设未保存。 ");
        const previous = rules.get(next.id);
        previous.onsuccess = guard(() => {
          if (expectedRevision) {
            const current = repositoryPresetSchema.parse(previous.result);
            if (
              current.revision !== expectedRevision ||
              current.repositoryId !== next.repositoryId
            )
              throw new Error("预设已变化，请重新打开编辑。 ");
          } else if (previous.result)
            throw new Error("预设ID已存在，请重新新增。 ");
          rules.put(next);
          set(next);
        });
      });
    },
  );
}
export async function removePreset(id: string, expectedRevision: string) {
  await ensureMigration();
  await transact<void>([LOCAL.presets], "readwrite", (tx, set, guard) => {
    const store = tx.objectStore(LOCAL.presets),
      read = store.get(id);
    read.onsuccess = guard(() => {
      const row = repositoryPresetSchema.parse(read.result);
      if (row.revision !== expectedRevision)
        throw new Error("预设已变化，请重新确认删除。 ");
      store.delete(id);
      set(undefined);
    });
  });
}
/** 确认摘要包含当时的全部所属预设；新增/编辑/删除后必须重新确认。 */
export async function removeRepository(
  repository: Repository,
  presets: RepositoryPreset[],
) {
  await ensureMigration();
  await transact<void>(
    [LOCAL.repositories, LOCAL.presets],
    "readwrite",
    (tx, set, guard) => {
      const roots = tx.objectStore(LOCAL.repositories),
        rules = tx.objectStore(LOCAL.presets),
        readRoot = roots.get(repository.id),
        readRules = rules.getAll();
      let completed = 0;
      const finish = guard(() => {
        if (++completed !== 2) return;
        const current = repositorySchema.parse(readRoot.result);
        const signature = (rows: RepositoryPreset[]) =>
          JSON.stringify(
            rows
              .map((p) => [p.id, p.revision])
              .sort((a, b) => a[0].localeCompare(b[0])),
          );
        const children = readRules.result
          .map((row) => repositoryPresetSchema.parse(row))
          .filter((p) => p.repositoryId === repository.id);
        if (
          current.revision !== repository.revision ||
          signature(children) !== signature(presets)
        )
          throw new Error("仓库或所属预设已更新，请重新确认删除范围。 ");
        for (const child of children) rules.delete(child.id);
        roots.delete(repository.id);
        set(undefined);
      });
      readRoot.onsuccess = finish;
      readRules.onsuccess = finish;
    },
  );
}
