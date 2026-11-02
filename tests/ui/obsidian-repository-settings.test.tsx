// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  check: vi.fn(),
  authorize: vi.fn(),
  pick: vi.fn(),
  supported: true,
}));
vi.mock(
  "../../src/modules/obsidian-repository/connection",
  async (original) => ({
    ...(await original<object>()),
    getRepository: h.get,
    setRepository: h.set,
    clearRepository: h.clear,
    checkRepositoryRead: h.check,
    authorizeRepositoryRead: h.authorize,
    subscribeRepositoryChanges: () => () => {},
  }),
);
vi.mock("../../src/modules/obsidian-local/directory", () => ({
  isDirectoryPickerSupported: () => h.supported,
  pickDirectory: h.pick,
}));
vi.mock("../../src/modules/log/client", () => ({ clientLog: vi.fn() }));
import RepositorySettings from "../../src/modules/obsidian-repository/Settings";
import { RepositoryReadPermissionError } from "../../src/modules/obsidian-repository/connection";
const a = {
  id: "active",
  revision: "a",
  name: "独立仓库",
  handle: { name: "独立仓库" },
};
beforeEach(() => {
  vi.clearAllMocks();
  h.supported = true;
  h.get.mockResolvedValue(undefined);
  h.check.mockResolvedValue(undefined);
  h.pick.mockResolvedValue(a.handle);
  h.set.mockResolvedValue(a);
  h.clear.mockResolvedValue(undefined);
  h.authorize.mockResolvedValue(undefined);
});
afterEach(cleanup);
async function setup() {
  await act(async () => {
    render(<RepositorySettings />);
  });
}
it("未配置不读旧预设，明确选择后才连接，保存失败保留旧连接", async () => {
  await setup();
  expect(screen.getByText("尚未连接 Obsidian 仓库")).toBeTruthy();
  expect(h.pick).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择仓库目录" }));
  });
  expect(h.set).toHaveBeenCalledWith(a.handle);
  expect(screen.getByText("已连接：独立仓库")).toBeTruthy();
  h.set.mockRejectedValueOnce(Error("quota"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "更换仓库目录" }));
  });
  expect(screen.getByText("已连接：独立仓库")).toBeTruthy();
  expect(screen.getByText("quota")).toBeTruthy();
});
it("取消替换保留原连接，清除需站内确认，取消不写", async () => {
  h.get.mockResolvedValue(a);
  h.pick.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "更换仓库目录" }));
  });
  expect(h.set).not.toHaveBeenCalled();
  expect(screen.getByText("已连接：独立仓库")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除连接" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(h.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "清除连接" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认清除连接" }));
  });
  expect(h.clear).toHaveBeenCalledTimes(1);
  expect(screen.getByText("尚未连接 Obsidian 仓库")).toBeTruthy();
});
it("失效权限不自动request，明确点击只读重授", async () => {
  h.get.mockResolvedValue(a);
  h.check.mockRejectedValueOnce(new RepositoryReadPermissionError("prompt"));
  await setup();
  expect(h.authorize).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "重新授权仓库（只读）" }),
    );
  });
  expect(h.authorize).toHaveBeenCalledWith(a);
  expect(screen.getByText("仓库读取授权已恢复。")).toBeTruthy();
});
it("不支持时不显示假连接成功，页面只用网站按钮", async () => {
  h.supported = false;
  await setup();
  expect(
    (screen.getByRole("button", { name: "选择仓库目录" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(h.pick).not.toHaveBeenCalled();
});
it("组件卸载后的目录picker结果不保存", async () => {
  let finish!: (x: unknown) => void;
  h.pick.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "选择仓库目录" }));
  cleanup();
  await act(async () => {
    finish(a.handle);
  });
  expect(h.set).not.toHaveBeenCalled();
});
