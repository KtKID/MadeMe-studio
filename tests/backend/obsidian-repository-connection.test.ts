import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getRepository,
  setRepository,
  clearRepository,
  assertRepositoryCurrent,
  authorizeRepositoryRead,
  subscribeRepositoryChanges,
} from "../../src/modules/obsidian-repository/connection";
import {
  putPreset,
  listPresets,
  deletePreset,
} from "../../src/modules/obsidian-local/presets";
import {
  presetSchema,
  type DirectoryHandle,
} from "../../src/modules/obsidian-local/contracts";
import { readConnectedMarkdown } from "../../src/modules/markdown-import/repository-import";
const databases = new Map<string, Map<string, unknown>>();
let abort = false;
function install() {
  vi.stubGlobal("indexedDB", {
    open: vi.fn((name: string, version: number) => {
      expect(version).toBe(1);
      const req: any = {};
      queueMicrotask(() => {
        if (!databases.has(name)) databases.set(name, new Map());
        const rows = databases.get(name)!;
        req.result = {
          objectStoreNames: { contains: () => true },
          close: vi.fn(),
          transaction: () => {
            const tx: any = {},
              changes: (() => void)[] = [];
            function request(action: () => unknown) {
              const r: any = {};
              queueMicrotask(() => {
                r.result = action();
                r.onsuccess?.();
                queueMicrotask(() => {
                  if (abort) {
                    tx.error = new DOMException("quota", "QuotaExceededError");
                    tx.onabort?.();
                  } else {
                    changes.forEach((f) => f());
                    tx.oncomplete?.();
                  }
                });
              });
              return r;
            }
            tx.objectStore = () => ({
              get: (key: string) => request(() => rows.get(key)),
              getAll: () => request(() => [...rows.values()]),
              put: (record: any) =>
                request(() => {
                  const key = record.preset?.id ?? record.id;
                  changes.push(() => rows.set(key, record));
                  return key;
                }),
              delete: (key: string) =>
                request(() => {
                  changes.push(() => rows.delete(key));
                }),
            });
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    }),
  });
}
function root(name = "vault"): DirectoryHandle {
  return {
    name,
    getDirectoryHandle: vi.fn(async () => root(".obsidian")),
    getFileHandle: vi.fn(),
    queryPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
  };
}
beforeEach(() => {
  databases.clear();
  abort = false;
  install();
});
afterEach(() => vi.unstubAllGlobals());
it("独立库不迁移预设，预设删除/改名不影响连接；清连接不删旧预设", async () => {
  const old = root("legacy"),
    connected = root("import");
  const preset = presetSchema.parse({
    id: "old",
    name: "导出预设",
    vaultName: "legacy",
    isVault: true,
  });
  await putPreset(preset, old);
  expect(await getRepository()).toBeUndefined();
  const saved = await setRepository(connected);
  await putPreset({ ...preset, name: "改名后的预设" }, old);
  expect((await getRepository())?.revision).toBe(saved.revision);
  await deletePreset("old");
  expect(await listPresets()).toEqual([]);
  expect((await getRepository())?.handle).toBe(connected);
  await putPreset(preset, old);
  await clearRepository();
  expect(await getRepository()).toBeUndefined();
  expect((await listPresets())[0].preset).toEqual(preset);
  expect([...databases.keys()].sort()).toEqual([
    "mademe-obsidian-local",
    "mademe-obsidian-repository",
  ]);
});
it("更换/清除连接使旧连接失效，不读旧根的同名MD", async () => {
  const a = root("a"),
    b = root("b"),
    old = await setRepository(a);
  const note = { getFile: vi.fn(), createWritable: vi.fn() };
  const current = await setRepository(b);
  await expect(assertRepositoryCurrent(old)).rejects.toThrow(/更换/);
  await expect(readConnectedMarkdown(old, note, 1000)).rejects.toThrow(/更换/);
  expect(note.getFile).not.toHaveBeenCalled();
  expect((await getRepository())?.handle).toBe(b);
  expect(current.revision).not.toBe(old.revision);
  await clearRepository();
  await expect(assertRepositoryCurrent(current)).rejects.toThrow(/清除/);
});
it("读取期间清除连接，迟到正文不能生成导入结果", async () => {
  const a = root(),
    note = {
      getFile: vi.fn(
        async () =>
          ({
            size: 10,
            text: async () => {
              await clearRepository();
              return "# late";
            },
          }) as File,
      ),
      createWritable: vi.fn(),
    };
  a.resolve = vi.fn(async () => ["note.md"]);
  const connection = await setRepository(a);
  await expect(readConnectedMarkdown(connection, note, 1000)).rejects.toThrow(
    /清除/,
  );
  expect(note.createWritable).not.toHaveBeenCalled();
});
it("仅明确重授权请求read；事务未提交不能报告成功或替换旧根", async () => {
  const a = root(),
    saved = await setRepository(a);
  expect(a.requestPermission).not.toHaveBeenCalled();
  await authorizeRepositoryRead(saved);
  expect(a.requestPermission).toHaveBeenCalledWith({ mode: "read" });
  abort = true;
  await expect(setRepository(root("bad"))).rejects.toThrow(/quota/);
  abort = false;
  expect((await getRepository())?.revision).toBe(saved.revision);
  abort = true;
  await expect(clearRepository()).rejects.toThrow(/quota/);
  abort = false;
  expect((await getRepository())?.revision).toBe(saved.revision);
});
it("字符串路径不能替代目录句柄；IDB不可用明确失败", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(getRepository()).rejects.toThrow(/IndexedDB/);
  await expect(clearRepository()).rejects.toThrow(/IndexedDB/);
});

it("通知通道被浏览器禁止不会把已提交连接误报失败，版本检查仍生效", async () => {
  const win = new EventTarget() as EventTarget & { BroadcastChannel: unknown };
  win.BroadcastChannel = class {
    constructor() {
      throw new DOMException("blocked", "SecurityError");
    }
  };
  vi.stubGlobal("window", win);
  const changed = vi.fn(),
    stop = subscribeRepositoryChanges(changed);
  const a = await setRepository(root("a"));
  const b = await setRepository(root("b"));
  expect(changed).toHaveBeenCalledTimes(2);
  expect((await getRepository())?.revision).toBe(b.revision);
  await expect(assertRepositoryCurrent(a)).rejects.toThrow(/更换/);
  stop();
});
