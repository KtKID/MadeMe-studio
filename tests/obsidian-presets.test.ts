import { afterEach, describe, expect, it, vi } from "vitest";
import {
  presetSchema,
  type DirectoryHandle,
} from "../src/modules/obsidian-local/contracts";
import {
  deletePreset,
  isDirectoryPickerSupported,
  listPresets,
  pickDirectory,
  putPreset,
  verifyVault,
} from "../src/modules/obsidian-local/presets";

const input = {
  id: "local-1",
  name: "写作库",
  vaultName: "Vault",
  isVault: true,
};
const directory = (extra: Partial<DirectoryHandle> = {}): DirectoryHandle => ({
  name: "Vault",
  getDirectoryHandle: vi.fn(),
  getFileHandle: vi.fn(),
  ...extra,
});
afterEach(() => vi.unstubAllGlobals());

describe("Obsidian 本机预设协议", () => {
  it("默认笔记与图片位置，拒绝未知上传字段", () => {
    expect(presetSchema.parse(input)).toMatchObject({
      noteDirectory: "笔记",
      imageRule: "../asset",
    });
    expect(presetSchema.safeParse({ ...input, token: "不允许" }).success).toBe(
      false,
    );
  });
  it("拒绝空名称、绝对路径和图片越过授权根目录", () => {
    for (const patch of [
      { name: " " },
      { noteDirectory: "/private" },
      { noteDirectory: "C:\\vault" },
      { noteDirectory: "../private" },
      { imageRule: "../../asset" },
    ]) {
      expect(presetSchema.safeParse({ ...input, ...patch }).success).toBe(
        false,
      );
    }
    expect(
      presetSchema.safeParse({
        ...input,
        noteDirectory: "笔记/归档",
        imageRule: "../../asset",
      }).success,
    ).toBe(true);
  });
});

describe("浏览器目录授权边界", () => {
  it("不支持时明确失败而不是伪装下载已同步", async () => {
    vi.stubGlobal("window", {});
    expect(isDirectoryPickerSupported()).toBe(false);
    await expect(pickDirectory()).rejects.toThrow("浏览器不支持");
  });
  it("从 documents 开始，只在显式调用后显示选择器", async () => {
    const handle = directory();
    const picker = vi.fn().mockResolvedValue(handle);
    vi.stubGlobal("window", {
      showDirectoryPicker: picker,
      isSecureContext: true,
    });
    expect(isDirectoryPickerSupported()).toBe(true);
    expect(picker).not.toHaveBeenCalled();
    await expect(pickDirectory()).resolves.toBe(handle);
    expect(picker).toHaveBeenCalledWith({
      mode: "readwrite",
      startIn: "documents",
    });
  });
  it("取消原样拒绝，不退回别处写入", async () => {
    const error = new DOMException("cancel", "AbortError");
    vi.stubGlobal("window", {
      showDirectoryPicker: vi.fn().mockRejectedValue(error),
    });
    await expect(pickDirectory()).rejects.toBe(error);
  });
  it("只探测 .obsidian，不创建；普通文件夹与权限故障区分", async () => {
    const getDirectoryHandle = vi.fn().mockResolvedValue(directory());
    expect(await verifyVault(directory({ getDirectoryHandle }))).toBe(true);
    expect(getDirectoryHandle).toHaveBeenCalledWith(".obsidian", {
      create: false,
    });
    getDirectoryHandle.mockRejectedValue(
      new DOMException("missing", "NotFoundError"),
    );
    expect(await verifyVault(directory({ getDirectoryHandle }))).toBe(false);
    const denied = new DOMException("denied", "NotAllowedError");
    getDirectoryHandle.mockRejectedValue(denied);
    await expect(verifyVault(directory({ getDirectoryHandle }))).rejects.toBe(
      denied,
    );
  });
  it("IndexedDB 不可用明确报错，不能把未落盘预设报告成功", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(listPresets()).rejects.toThrow("IndexedDB");
    await expect(
      putPreset(presetSchema.parse(input), directory()),
    ).rejects.toThrow("IndexedDB");
    await expect(deletePreset(input.id)).rejects.toThrow("IndexedDB");
  });
});

/** 最小 IDB 协议替身：刻意分离 request 成功与 transaction 提交。 */
function installIndexedDB(abortAfterRequest = false) {
  const rows = new Map<string, unknown>();
  const close = vi.fn();
  const database = {
    close,
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    transaction: vi.fn(() => {
      const tx: Record<string, unknown> = { error: null };
      const request = (operation: () => unknown) => {
        const req: Record<string, unknown> = {};
        queueMicrotask(() => {
          req.result = operation();
          (req.onsuccess as () => void)?.();
          queueMicrotask(() => {
            if (abortAfterRequest) {
              tx.error = new DOMException("quota", "QuotaExceededError");
              (tx.onabort as () => void)?.();
            } else (tx.oncomplete as () => void)?.();
          });
        });
        return req;
      };
      tx.objectStore = () => ({
        getAll: () => request(() => [...rows.values()]),
        put: (record: { preset: { id: string } }) =>
          request(() => {
            rows.set(record.preset.id, record);
            return record.preset.id;
          }),
        delete: (id: string) =>
          request(() => {
            rows.delete(id);
            return undefined;
          }),
      });
      return tx;
    }),
  };
  const open = vi.fn(() => {
    const req: Record<string, unknown> = { result: database };
    queueMicrotask(() => (req.onsuccess as () => void)?.());
    return req;
  });
  vi.stubGlobal("indexedDB", { open });
  return { rows, open, close, database };
}

describe("目录句柄的 IndexedDB 本机事务", () => {
  it("按预设 ID 增删改，句柄不 JSON 化，读取后校验协议", async () => {
    const db = installIndexedDB();
    const handle = directory();
    const preset = presetSchema.parse(input);
    await putPreset(preset, handle);
    expect(await listPresets()).toEqual([{ preset, handle }]);
    await putPreset({ ...preset, name: "已改名" }, handle);
    expect(await listPresets()).toEqual([
      { preset: { ...preset, name: "已改名" }, handle },
    ]);
    await deletePreset(preset.id);
    expect(await listPresets()).toEqual([]);
    expect(db.close).toHaveBeenCalledTimes(6);
    expect(db.database.transaction).toHaveBeenCalledWith(
      "presets",
      "readwrite",
    );
  });
  it("request 已成功但事务最终 abort 仍报告失败", async () => {
    installIndexedDB(true);
    await expect(
      putPreset(presetSchema.parse(input), directory()),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
  });
  it("损坏的本机记录不能当作有效授权返回", async () => {
    const db = installIndexedDB();
    db.rows.set("broken", {
      preset: input,
      handle: { name: "只有字符串路径" },
    });
    await expect(listPresets()).rejects.toThrow("目录授权已失效");
    expect(db.close).toHaveBeenCalledOnce();
  });
});
