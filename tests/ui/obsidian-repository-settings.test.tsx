// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
const h = vi.hoisted(() => ({
  state: { repositories: [], presets: [] } as any,
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  savePreset: vi.fn(),
  removePreset: vi.fn(),
  check: vi.fn(),
  authorize: vi.fn(),
  confirm: vi.fn(),
  pick: vi.fn(),
  supported: true,
}));
vi.mock(
  "../../src/modules/obsidian-repository/connection",
  async (original) => ({
    ...(await original<object>()),
    listWorkspace: h.list,
    addRepository: h.add,
    deleteRepository: h.remove,
    savePreset: h.savePreset,
    removePreset: h.removePreset,
    checkRepositoryRead: h.check,
    authorizeRepositoryRead: h.authorize,
    confirmRepositoryIdentity: h.confirm,
    subscribeRepositoryChanges: () => () => {},
  }),
);
vi.mock("../../src/modules/obsidian-local/directory", () => ({
  isDirectoryPickerSupported: () => h.supported,
  pickDirectory: h.pick,
}));
vi.mock("../../src/modules/log/client", () => ({ clientLog: vi.fn() }));
import RepositorySettings from "../../src/modules/obsidian-repository/Settings";
const a = {
    id: "11111111-1111-4111-8111-111111111111",
    revision: "22222222-2222-4222-8222-222222222222",
    name: "仓库A",
    identity: "confirmed",
    isVault: true,
    handle: {
      name: "仓库A",
      queryPermission: vi.fn(async () => "granted"),
      resolve: vi.fn(async () => ["notes"]),
    },
  },
  b = { ...a, id: "33333333-3333-4333-8333-333333333333", name: "仓库B" };
const p = {
  id: "44444444-4444-4444-8444-444444444444",
  revision: "55555555-5555-4555-8555-555555555555",
  repositoryId: a.id,
  name: "写作预设",
  noteDirectory: "notes",
  imageRule: "../assets",
};
beforeEach(() => {
  vi.clearAllMocks();
  h.supported = true;
  h.state = { repositories: [a, b], presets: [p] };
  h.list.mockImplementation(async () => h.state);
  h.check.mockResolvedValue(undefined);
  h.pick.mockResolvedValue({ name: "notes" });
  h.authorize.mockResolvedValue(undefined);
  h.confirm.mockResolvedValue(a);
  h.savePreset.mockImplementation(async (rule) => {
    h.state = { ...h.state, presets: [rule] };
  });
  h.removePreset.mockImplementation(async () => {
    h.state = { ...h.state, presets: [] };
  });
  h.remove.mockImplementation(async (root) => {
    h.state = {
      repositories: h.state.repositories.filter((r: any) => r.id !== root.id),
      presets: h.state.presets.filter((x: any) => x.repositoryId !== root.id),
    };
  });
});
afterEach(cleanup);
async function setup() {
  await act(async () => {
    render(<RepositorySettings />);
  });
}
function card(id = a.id) {
  return document.querySelector(`[data-repository-id="${id}"]`) as HTMLElement;
}
it("仓库和所属子列表始终并存，编辑取消不遮掉原列表", async () => {
  await setup();
  expect(screen.getByText("写作预设")).toBeTruthy();
  expect(document.querySelectorAll(".repository-card")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "编辑 写作预设" }));
  expect(screen.getByLabelText("预设名称")).toBeTruthy();
  expect(screen.getByText("写作预设")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
  expect(screen.getByText("写作预设")).toBeTruthy();
  expect(h.savePreset).not.toHaveBeenCalled();
});
it("新增子预设只选所属根内子目录，保存规则没有handle", async () => {
  await setup();
  fireEvent.click(within(card()).getByRole("button", { name: "新增预设" }));
  fireEvent.change(screen.getByLabelText("预设名称"), {
    target: { value: "新规则" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择文章子目录" }));
  });
  expect(h.pick).toHaveBeenCalledWith(a.handle);
  expect(h.add).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "保存所属预设" }));
  });
  expect(h.savePreset.mock.calls[0][0]).toMatchObject({
    repositoryId: a.id,
    name: "新规则",
    noteDirectory: "notes",
  });
  expect(h.savePreset.mock.calls[0][0]).not.toHaveProperty("handle");
  expect(document.querySelectorAll(".repository-card")).toHaveLength(2);
});
it("新增仓库取消保留全部卡片与预设", async () => {
  h.pick.mockRejectedValue(new DOMException("cancel", "AbortError"));
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "新增 Obsidian 仓库" }));
  });
  expect(h.add).not.toHaveBeenCalled();
  expect(screen.getByText("写作预设")).toBeTruthy();
  expect(document.querySelectorAll(".repository-card")).toHaveLength(2);
});
it("仓库删除确认准确列名称和预设数量，取消不删，确认传快照", async () => {
  await setup();
  fireEvent.click(within(card()).getByRole("button", { name: "删除仓库" }));
  let modal = screen.getByRole("dialog", { name: "删除 Obsidian 仓库？" });
  expect(modal.textContent).toContain("1 个预设");
  expect(modal.textContent).toContain("写作预设");
  expect(modal.textContent).toContain("仓库A");
  fireEvent.click(within(modal).getByRole("button", { name: "取消" }));
  expect(h.remove).not.toHaveBeenCalled();
  fireEvent.click(within(card()).getByRole("button", { name: "删除仓库" }));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "确认删除仓库及所属预设" }),
    );
  });
  expect(h.remove).toHaveBeenCalledWith(a, [p]);
  expect(document.querySelectorAll(".repository-card")).toHaveLength(1);
  expect(h.removePreset).not.toHaveBeenCalled();
});
it("单删预设不删仓库，仓库更新时拒绝旧确认并保留列表", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "删除 写作预设" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认删除预设" }));
  });
  expect(h.removePreset).toHaveBeenCalledWith(p.id, p.revision);
  expect(h.remove).not.toHaveBeenCalled();
  expect(document.querySelectorAll(".repository-card")).toHaveLength(2);
  h.remove.mockRejectedValue(
    Error("仓库或所属预设已更新，请重新确认删除范围。"),
  );
  fireEvent.click(within(card()).getByRole("button", { name: "删除仓库" }));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "确认删除仓库及所属预设" }),
    );
  });
  expect(
    (
      screen.getByRole("button", {
        name: "确认删除仓库及所属预设",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(document.querySelectorAll(".repository-card")).toHaveLength(2);
});
it("待确认旧根清楚展示，读取恢复不自动request或写权限", async () => {
  h.state = {
    repositories: [
      {
        ...a,
        identity: "pending",
        handle: { ...a.handle, queryPermission: async () => "prompt" },
      },
    ],
    presets: [p],
  };
  await setup();
  expect(screen.getByText(/历史目录待确认/)).toBeTruthy();
  expect(h.authorize).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "重新授权读取" }));
  });
  expect(h.authorize).toHaveBeenCalled();
  expect(screen.getByText("写作预设")).toBeTruthy();
});
