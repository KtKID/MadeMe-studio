import { afterEach, expect, it, vi } from "vitest";
import {
  resetDirectoryQueryForTests,
  setDirectoryQueryTimeoutForTests,
  takeRepositoryLoadProblem,
} from "../../src/modules/obsidian-repository/deadline";
import * as logClient from "../../src/modules/log/client";
import { checkRepositoryRead } from "../../src/modules/obsidian-repository/connection";
import { planLegacyMigration } from "../../src/modules/obsidian-repository/migration";
import { repositoryPresetSchema } from "../../src/modules/obsidian-repository/models";
import {
  presetSchema,
  type DirectoryHandle,
} from "../../src/modules/obsidian-local/contracts";
function root(
  identity: string,
  name = "同名仓库",
  comparable = true,
): DirectoryHandle {
  const handle: DirectoryHandle & { identity?: string } = {
    name,
    identity,
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    queryPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(),
  };
  if (comparable)
    handle.isSameEntry = async (other) =>
      (other as typeof handle).identity === identity;
  return handle;
}
function record(handle: DirectoryHandle, id: string) {
  return {
    handle,
    preset: presetSchema.parse({
      id,
      name: "预设" + id,
      vaultName: handle.name,
      noteDirectory: "notes",
      imageRule: "../assets",
      isVault: true,
    }),
  };
}
it("两套旧源同根须证明合并，所有预设与规则保持，单连接无预设也保留", async () => {
  const first = root("a"),
    clone = root("a"),
    another = root("b");
  const plan = await planLegacyMigration(
    [record(clone, "p1"), record(first, "p2"), record(another, "p3")],
    {
      id: "active",
      revision: crypto.randomUUID(),
      name: first.name,
      handle: first,
    },
  );
  expect(plan.repositories).toHaveLength(2);
  expect(plan.presets).toHaveLength(3);
  const a = plan.repositories.find((r) => r.handle === first)!;
  expect(
    plan.presets.filter((p) => p.repositoryId === a.id).map((p) => p.name),
  ).toEqual(["预设p1", "预设p2"]);
  expect(
    plan.presets.every(
      (p) => p.noteDirectory === "notes" && p.imageRule === "../assets",
    ),
  ).toBe(true);
  expect(plan.presets.every((p) => !("handle" in p))).toBe(true);
  expect(first.getFileHandle).not.toHaveBeenCalled();
  expect(first.getDirectoryHandle).not.toHaveBeenCalled();
  expect(first.requestPermission).not.toHaveBeenCalled();
  const only = await planLegacyMigration([], {
    id: "active",
    revision: crypto.randomUUID(),
    name: first.name,
    handle: first,
  });
  expect(only.repositories).toHaveLength(1);
  expect(only.presets).toEqual([]);
});
it("同名不同根不能按名字合并；不可比较分别保留且显式待确认", async () => {
  const one = root("a"),
    two = root("b");
  expect(
    (await planLegacyMigration([record(one, "1"), record(two, "2")]))
      .repositories,
  ).toHaveLength(2);
  const unknownA = root("a", "同名", false),
    unknownB = root("b", "同名", false);
  const pending = await planLegacyMigration([
    record(unknownA, "1"),
    record(unknownB, "2"),
  ]);
  expect(pending.repositories).toHaveLength(2);
  expect(pending.repositories.every((r) => r.identity === "pending")).toBe(
    true,
  );
  expect(new Set(pending.presets.map((p) => p.repositoryId)).size).toBe(2);
});
it("身份比较权限不足不丢旧handle，不自动请求权限", async () => {
  const a = root("a"),
    b = root("b");
  a.isSameEntry = vi.fn(async () => {
    throw new DOMException("denied", "NotAllowedError");
  });
  const plan = await planLegacyMigration([record(a, "1"), record(b, "2")]);
  expect(plan.repositories.map((r) => r.handle)).toEqual([a, b]);
  expect(plan.repositories.every((r) => r.identity === "pending")).toBe(true);
  expect(a.requestPermission).not.toHaveBeenCalled();
});
it("无读取授权仍保留历史配置并待确认", async () => {
  const a = root("a");
  a.queryPermission = vi.fn(async () => "prompt" as const);
  const plan = await planLegacyMigration([record(a, "1")]);
  expect(plan.repositories[0].identity).toBe("pending");
  expect(plan.presets).toHaveLength(1);
  expect(a.requestPermission).not.toHaveBeenCalled();
});
afterEach(() => {
  resetDirectoryQueryForTests();
  vi.restoreAllMocks();
});
it(
  "queryPermission 一直不返回时仍保留历史配置并待确认",
  { timeout: 1000 },
  async () => {
    const spy = vi.spyOn(logClient, "clientLog").mockImplementation(() => {});
    setDirectoryQueryTimeoutForTests(30);
    const a = root("a");
    a.queryPermission = vi.fn(() => new Promise<PermissionState>(() => {}));
    const plan = await planLegacyMigration([record(a, "1")]);
    expect(plan.repositories).toHaveLength(1);
    expect(plan.repositories[0]?.identity).toBe("pending");
    expect(plan.repositories[0]?.handle).toBe(a);
    expect(plan.presets).toHaveLength(1);
    expect(a.requestPermission).not.toHaveBeenCalled();
    expect(takeRepositoryLoadProblem()).toMatch(/超时/);
    expect(spy).toHaveBeenCalledWith(
      "warn",
      "obsidian_repository.migration_permission_pending",
      expect.objectContaining({ reason: "timeout" }),
    );
  },
);
it(
  "isSameEntry 一直不返回时分开保留两边，不申请权限",
  { timeout: 1000 },
  async () => {
    const spy = vi.spyOn(logClient, "clientLog").mockImplementation(() => {});
    setDirectoryQueryTimeoutForTests(30);
    const a = root("a");
    const b = root("b");
    const hang = () => new Promise<boolean>(() => {});
    a.isSameEntry = hang;
    b.isSameEntry = hang;
    const plan = await planLegacyMigration([record(a, "1"), record(b, "2")]);
    expect(plan.repositories.map((item) => item.handle)).toEqual([a, b]);
    expect(plan.repositories.every((item) => item.identity === "pending")).toBe(
      true,
    );
    expect(plan.presets).toHaveLength(2);
    expect(a.requestPermission).not.toHaveBeenCalled();
    expect(b.requestPermission).not.toHaveBeenCalled();
    expect(takeRepositoryLoadProblem()).toMatch(/保留/);
    expect(spy).toHaveBeenCalledWith(
      "warn",
      "obsidian_repository.identity_pending",
      expect.objectContaining({ reason: "timeout" }),
    );
  },
);
it(
  "读取校验遇到挂起的 queryPermission 时在时限内失败，不申请写权限",
  { timeout: 1000 },
  async () => {
    setDirectoryQueryTimeoutForTests(30);
    const directory = root("vault");
    directory.queryPermission = vi.fn(
      () => new Promise<PermissionState>(() => {}),
    );
    await expect(
      checkRepositoryRead({ name: directory.name, handle: directory }),
    ).rejects.toThrow(/超时/);
    expect(directory.requestPermission).not.toHaveBeenCalled();
  },
);
it("子预设与旧预设共用路径边界，禁止自带handle或越根", () => {
  const value = {
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    repositoryId: crypto.randomUUID(),
    name: "p",
    noteDirectory: "notes",
    imageRule: "../assets",
  };
  expect(repositoryPresetSchema.safeParse(value).success).toBe(true);
  for (const patch of [
    { noteDirectory: "../outside" },
    { imageRule: "../../outside" },
    { handle: root("a") },
  ])
    expect(
      repositoryPresetSchema.safeParse({ ...value, ...patch }).success,
    ).toBe(false);
});
