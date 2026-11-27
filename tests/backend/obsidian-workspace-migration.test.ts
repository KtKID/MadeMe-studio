import { afterEach, expect, it, vi } from "vitest";
import {
  OBSIDIAN_LOCAL_DEFAULTS,
  OBSIDIAN_REPOSITORY_LOCAL,
  OBSIDIAN_WORKSPACE_LOCAL as WORKSPACE,
} from "../../src/modules/config/limits";
import {
  resetLoadDeadlineForTests,
  setDirectoryQueryTimeoutForTests,
  takeRepositoryLoadProblem,
} from "../../src/modules/obsidian-repository/deadline";
import { setIndexedDbOpenTimeoutForTests } from "../../src/modules/obsidian-repository/idb";
import { legacyMigrationPlan } from "../../src/modules/obsidian-repository/migration";
import {
  listWorkspace,
  resetWorkspaceMigrationForTests,
} from "../../src/modules/obsidian-repository/store";
import type { DirectoryHandle } from "../../src/modules/obsidian-local/contracts";

type StoreData = { keyPath: string; rows: Map<string, unknown> };
type DbData = { version: number; stores: Map<string, StoreData> };
type FakeOptions = {
  /** 打开这些库名时不触发任何回调，模拟卡住的 IDB 请求。 */
  hangOpens?: Set<string>;
  /** 触发 onblocked 后仍不结束，模拟被其他标签页拖住。 */
  blockOpens?: Set<string>;
  /** 模拟 WebKit：升级事务 abort 后 open 既不成功也不失败。 */
  hangOnUpgradeAbort?: boolean;
  /** 不提供 databases()，走打开探测回退路径。 */
  hideDatabasesApi?: boolean;
  /** 这些库的读写请求不触发回调，模拟打开成功后事务一直挂起。 */
  hangReads?: Set<string>;
};

let uninstall: (() => void) | undefined;
let memory: Map<string, DbData>;
let openedNames: string[];
let deletedNames: string[];

function keyOf(keyPath: string, value: unknown) {
  return keyPath
    .split(".")
    .reduce((current: any, part) => current?.[part], value);
}

function installFakeIndexedDB(options: FakeOptions = {}) {
  memory = new Map();
  openedNames = [];
  deletedNames = [];
  const hangOpens = options.hangOpens ?? new Set();
  const blockOpens = options.blockOpens ?? new Set();
  function namesList(db: DbData) {
    const names = [...db.stores.keys()];
    return {
      contains: (name: string) => db.stores.has(name),
      get length() {
        return names.length;
      },
      *[Symbol.iterator]() {
        yield* names;
      },
    };
  }
  function transaction(
    db: DbData,
    storeNames: string | string[],
    mode: IDBTransactionMode,
    dbName = "",
  ) {
    const hang = options.hangReads?.has(dbName) ?? false;
    let pending = 0,
      finished = false,
      aborted = false;
    const tx: any = { error: null, mode };
    const completeIfIdle = () => {
      if (finished || aborted || pending !== 0) return;
      finished = true;
      tx.oncomplete?.();
    };
    const run = (work: () => unknown) => {
      const request: any = { result: undefined, error: null };
      pending++;
      queueMicrotask(() => {
        if (aborted || finished || hang) return;
        try {
          request.result = work();
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          tx.error = error;
          aborted = true;
          tx.onerror?.();
          tx.onabort?.();
          return;
        }
        pending--;
        queueMicrotask(completeIfIdle);
      });
      return request;
    };
    tx.objectStore = (name: string) => {
      const store = db.stores.get(name);
      if (!store) throw new Error("missing store " + name);
      return {
        get: (key: string) => run(() => store.rows.get(key)),
        getAll: () => run(() => [...store.rows.values()]),
        count: () => run(() => store.rows.size),
        put: (value: unknown) =>
          run(() => {
            if (mode === "readonly") throw new Error("readonly");
            const key = String(keyOf(store.keyPath, value));
            store.rows.set(key, value);
            return key;
          }),
        delete: (key: string) =>
          run(() => {
            if (mode === "readonly") throw new Error("readonly");
            store.rows.delete(key);
          }),
      };
    };
    tx.abort = () => {
      aborted = true;
      queueMicrotask(() => tx.onabort?.());
    };
    return tx;
  }
  function databaseObject(name: string, db: DbData) {
    const object: any = {
      name,
      get version() {
        return db.version;
      },
      get objectStoreNames() {
        return namesList(db);
      },
      close: vi.fn(),
      onversionchange: null,
      createObjectStore(storeName: string, opts: { keyPath: string }) {
        if (!db.stores.has(storeName))
          db.stores.set(storeName, { keyPath: opts.keyPath, rows: new Map() });
        return transaction(db, storeName, "versionchange").objectStore(
          storeName,
        );
      },
      transaction: (storeNames: string | string[], mode: IDBTransactionMode) =>
        transaction(db, storeNames, mode, name),
    };
    return object;
  }
  const indexedDB = {
    databases: options.hideDatabasesApi
      ? undefined
      : async () =>
          [...memory.entries()].map(([name, db]) => ({
            name,
            version: db.version,
          })),
    deleteDatabase(name: string) {
      const request: any = { result: undefined, error: null };
      queueMicrotask(() => {
        deletedNames.push(name);
        memory.delete(name);
        request.onsuccess?.();
      });
      return request;
    },
    open(name: string, version?: number) {
      const request: any = {
        result: undefined,
        error: null,
        transaction: null,
      };
      openedNames.push(name);
      queueMicrotask(() => {
        if (hangOpens.has(name)) return;
        if (blockOpens.has(name)) {
          request.onblocked?.();
          return;
        }
        let db = memory.get(name);
        const created = !db;
        if (!db) {
          db = { version: version ?? 1, stores: new Map() };
          memory.set(name, db);
        }
        const targetVersion = version ?? db.version;
        if (db.version > targetVersion) {
          request.error = new DOMException("version", "VersionError");
          request.onerror?.();
          return;
        }
        request.result = databaseObject(name, db);
        let aborted = false;
        if (created || db.version < targetVersion) {
          db.version = targetVersion;
          const upgradeTx = transaction(
            db,
            [...db.stores.keys()],
            "versionchange",
          );
          const originalAbort = upgradeTx.abort;
          upgradeTx.abort = () => {
            aborted = true;
            originalAbort();
          };
          request.transaction = upgradeTx;
          request.onupgradeneeded?.({ target: request });
          request.transaction = null;
          if (aborted) {
            memory.delete(name);
            if (options.hangOnUpgradeAbort) return;
            request.error = new DOMException(
              "Version change transaction was aborted in upgradeneeded event handler.",
              "AbortError",
            );
            request.onerror?.();
            return;
          }
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
  vi.stubGlobal("indexedDB", indexedDB);
  uninstall = () => {
    vi.unstubAllGlobals();
    uninstall = undefined;
  };
  return { memory, openedNames, deletedNames };
}

function handle(name = "brain"): DirectoryHandle {
  const directory: DirectoryHandle = {
    name,
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    queryPermission: vi.fn(async () => "granted" as const),
    isSameEntry: async (other) => other === directory || other.name === name,
  };
  return directory;
}

async function seed(
  name: string,
  storeName: string,
  keyPath: string,
  rows: unknown[],
) {
  const db = memory.get(name) ?? { version: 1, stores: new Map() };
  db.stores.set(storeName, {
    keyPath,
    rows: new Map(rows.map((row) => [String(keyOf(keyPath, row)), row])),
  });
  memory.set(name, db);
}

function presetRecord(directory: DirectoryHandle, id = "old-a1") {
  return {
    preset: {
      id,
      name: "写作",
      vaultName: directory.name,
      noteDirectory: "notes",
      imageRule: "../assets",
      isVault: true,
    },
    handle: directory,
  };
}

afterEach(() => {
  resetWorkspaceMigrationForTests();
  setIndexedDbOpenTimeoutForTests();
  resetLoadDeadlineForTests();
  uninstall?.();
  vi.useRealTimers();
});

it("设置页读取时限长于单次目录查询和 IndexedDB 操作", () => {
  expect(WORKSPACE.settingsLoadTimeoutMs).toBeGreaterThan(
    WORKSPACE.directoryQueryTimeoutMs,
  );
  expect(WORKSPACE.settingsLoadTimeoutMs).toBeGreaterThan(
    WORKSPACE.indexedDbTimeoutMs,
  );
});

it(
  "旧库不存在且 abort 探测卡住时，兼容读取必须结束并得到空配置",
  { timeout: 1000 },
  async () => {
    installFakeIndexedDB({ hangOnUpgradeAbort: true });
    await expect(legacyMigrationPlan()).resolves.toEqual({
      repositories: [],
      presets: [],
    });
  },
);

it(
  "旧库不存在时设置页所用的 listWorkspace 必须结束为空，不能一直加载",
  { timeout: 1000 },
  async () => {
    installFakeIndexedDB({ hangOnUpgradeAbort: true });
    await expect(listWorkspace()).resolves.toEqual({
      repositories: [],
      presets: [],
    });
  },
);

it(
  "没有 databases() 时也不靠 abort 探测；旧库缺席应得到空配置",
  { timeout: 1000 },
  async () => {
    installFakeIndexedDB({ hideDatabasesApi: true, hangOnUpgradeAbort: true });
    await expect(legacyMigrationPlan()).resolves.toEqual({
      repositories: [],
      presets: [],
    });
  },
);

it(
  "遗留的空库（无对象仓库）视为旧配置不存在，而不是结构错误或转圈",
  { timeout: 1000 },
  async () => {
    installFakeIndexedDB();
    memory.set(OBSIDIAN_LOCAL_DEFAULTS.databaseName, {
      version: 1,
      stores: new Map(),
    });
    memory.set(OBSIDIAN_REPOSITORY_LOCAL.databaseName, {
      version: 1,
      stores: new Map(),
    });
    await expect(legacyMigrationPlan()).resolves.toEqual({
      repositories: [],
      presets: [],
    });
  },
);

it("已有旧预设和独立连接时仍按计划迁移，且不删除旧库", async () => {
  installFakeIndexedDB();
  const directory = handle();
  await seed(
    OBSIDIAN_LOCAL_DEFAULTS.databaseName,
    OBSIDIAN_LOCAL_DEFAULTS.presetStore,
    "preset.id",
    [presetRecord(directory)],
  );
  await seed(
    OBSIDIAN_REPOSITORY_LOCAL.databaseName,
    OBSIDIAN_REPOSITORY_LOCAL.store,
    "id",
    [
      {
        id: OBSIDIAN_REPOSITORY_LOCAL.key,
        revision: "11111111-1111-4111-8111-111111111111",
        name: "brain",
        handle: directory,
      },
    ],
  );
  const state = await listWorkspace();
  expect(state.repositories).toHaveLength(1);
  expect(state.presets).toHaveLength(1);
  expect(state.presets[0]?.name).toBe("写作");
  expect(state.repositories[0]?.handle).toBe(directory);
  expect(memory.has(OBSIDIAN_LOCAL_DEFAULTS.databaseName)).toBe(true);
  expect(memory.has(OBSIDIAN_REPOSITORY_LOCAL.databaseName)).toBe(true);
  expect(deletedNames).not.toContain(OBSIDIAN_LOCAL_DEFAULTS.databaseName);
  expect(deletedNames).not.toContain(OBSIDIAN_REPOSITORY_LOCAL.databaseName);
  expect(deletedNames).not.toContain(WORKSPACE.databaseName);
});

it(
  "已经迁移完成时不再读旧库；即使旧库打开会卡住也要立刻返回已有仓库",
  { timeout: 1000 },
  async () => {
    const directory = handle("保留仓库");
    const repository = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "保留仓库",
      handle: directory,
      identity: "confirmed" as const,
      isVault: true,
    };
    installFakeIndexedDB({
      hangOpens: new Set([
        OBSIDIAN_LOCAL_DEFAULTS.databaseName,
        OBSIDIAN_REPOSITORY_LOCAL.databaseName,
      ]),
    });
    await seed(WORKSPACE.databaseName, WORKSPACE.repositories, "id", [
      repository,
    ]);
    await seed(WORKSPACE.databaseName, WORKSPACE.presets, "id", []);
    await seed(WORKSPACE.databaseName, WORKSPACE.meta, "id", [
      {
        id: WORKSPACE.migrationKey,
        complete: true,
        repositories: 1,
        presets: 0,
      },
    ]);
    const state = await listWorkspace();
    expect(state.repositories).toHaveLength(1);
    expect(state.repositories[0]?.name).toBe("保留仓库");
    expect(openedNames).not.toContain(OBSIDIAN_LOCAL_DEFAULTS.databaseName);
    expect(openedNames).not.toContain(OBSIDIAN_REPOSITORY_LOCAL.databaseName);
    expect(deletedNames).toEqual([]);
  },
);

it(
  "打开已存在旧库若一直无回调，必须报明确超时错误，不能无限等待",
  { timeout: 1000 },
  async () => {
    const { setIndexedDbOpenTimeoutForTests } =
      await import("../../src/modules/obsidian-repository/idb");
    setIndexedDbOpenTimeoutForTests(40);
    try {
      installFakeIndexedDB({
        hangOpens: new Set([OBSIDIAN_LOCAL_DEFAULTS.databaseName]),
      });
      memory.set(OBSIDIAN_LOCAL_DEFAULTS.databaseName, {
        version: 1,
        stores: new Map([
          [
            OBSIDIAN_LOCAL_DEFAULTS.presetStore,
            { keyPath: "preset.id", rows: new Map() },
          ],
        ]),
      });
      await expect(legacyMigrationPlan()).rejects.toThrow(/超时/);
    } finally {
      setIndexedDbOpenTimeoutForTests();
    }
  },
);

it(
  "被其他标签页阻塞且请求不再结束时，也要超时失败而不是转圈",
  { timeout: 1000 },
  async () => {
    const { setIndexedDbOpenTimeoutForTests } =
      await import("../../src/modules/obsidian-repository/idb");
    setIndexedDbOpenTimeoutForTests(40);
    try {
      installFakeIndexedDB({
        hideDatabasesApi: true,
        blockOpens: new Set([WORKSPACE.databaseName]),
      });
      await expect(listWorkspace()).rejects.toThrow(/阻塞|超时/);
    } finally {
      setIndexedDbOpenTimeoutForTests();
    }
  },
);

it(
  "打开成功后读取事务一直无回调时必须超时，且不删除已有仓库",
  { timeout: 1000 },
  async () => {
    const { setIndexedDbOpenTimeoutForTests } =
      await import("../../src/modules/obsidian-repository/idb");
    setIndexedDbOpenTimeoutForTests(40);
    try {
      const directory = handle("保留仓库");
      const repository = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "保留仓库",
        handle: directory,
        identity: "confirmed" as const,
        isVault: true,
      };
      installFakeIndexedDB({ hangReads: new Set([WORKSPACE.databaseName]) });
      await seed(WORKSPACE.databaseName, WORKSPACE.repositories, "id", [
        repository,
      ]);
      await seed(WORKSPACE.databaseName, WORKSPACE.presets, "id", []);
      await seed(WORKSPACE.databaseName, WORKSPACE.meta, "id", [
        {
          id: WORKSPACE.migrationKey,
          complete: true,
          repositories: 1,
          presets: 0,
        },
      ]);
      await expect(listWorkspace()).rejects.toThrow(/超时/);
      const rows = memory
        .get(WORKSPACE.databaseName)
        ?.stores.get(WORKSPACE.repositories)?.rows;
      expect(rows?.size).toBe(1);
      expect([...rows!.values()][0]).toMatchObject({ name: "保留仓库" });
      expect(deletedNames).toEqual([]);
    } finally {
      setIndexedDbOpenTimeoutForTests();
    }
  },
);

it(
  "旧目录身份比较挂起时仍完成迁移，新旧数据都保留",
  { timeout: 1000 },
  async () => {
    setDirectoryQueryTimeoutForTests(30);
    installFakeIndexedDB();
    const first = handle("甲");
    const second = handle("乙");
    const hang = () => new Promise<boolean>(() => {});
    first.isSameEntry = hang;
    second.isSameEntry = hang;
    await seed(
      OBSIDIAN_LOCAL_DEFAULTS.databaseName,
      OBSIDIAN_LOCAL_DEFAULTS.presetStore,
      "preset.id",
      [presetRecord(first, "old-a"), presetRecord(second, "old-b")],
    );
    const state = await listWorkspace();
    expect(state.repositories).toHaveLength(2);
    expect(
      state.repositories.every((item) => item.identity === "pending"),
    ).toBe(true);
    expect(state.presets).toHaveLength(2);
    expect(state.repositories.map((item) => item.handle)).toEqual([
      first,
      second,
    ]);
    expect(memory.has(OBSIDIAN_LOCAL_DEFAULTS.databaseName)).toBe(true);
    expect(deletedNames).not.toContain(OBSIDIAN_LOCAL_DEFAULTS.databaseName);
    expect(deletedNames).not.toContain(WORKSPACE.databaseName);
    expect(
      memory.get(WORKSPACE.databaseName)?.stores.get(WORKSPACE.repositories)
        ?.rows.size,
    ).toBe(2);
    expect(takeRepositoryLoadProblem()).toMatch(/超时/);
  },
);
