// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  assert: vi.fn(),
  subscribe: vi.fn(),
  changed: undefined as undefined | (() => void),
  check: vi.fn(),
  pick: vi.fn(),
  read: vi.fn(),
  authorize: vi.fn(),
  supported: true,
}));
vi.mock(
  "../../src/modules/obsidian-repository/connection",
  async (original) => ({
    ...(await original<object>()),
    getRepository: h.get,
    assertRepositoryCurrent: h.assert,
    checkRepositoryRead: h.check,
    authorizeRepositoryRead: h.authorize,
    subscribeRepositoryChanges: h.subscribe,
  }),
);
vi.mock(
  "../../src/modules/markdown-import/repository-import",
  async (original) => ({
    ...(await original<object>()),
    pickRepositoryMarkdown: h.pick,
    readConnectedMarkdown: h.read,
    supportsRepositoryFilePicker: () => h.supported,
  }),
);
vi.mock("../../src/modules/log/client", () => ({ clientLog: vi.fn() }));
import RepositoryImportButton from "../../src/modules/markdown-import/RepositoryImportButton";
import { RepositoryReadPermissionError } from "../../src/modules/obsidian-repository/connection";
const record = (id: string) => ({
  id: "active",
  revision: id,
  name: "仓库" + id,
  handle: {},
});
function setup() {
  const onChosen = vi.fn(async () => {}),
    onBegin = vi.fn(() => ({ request: 1, sequence: 0 })),
    onManual = vi.fn();
  render(
    <RepositoryImportButton
      maxBytes={1000}
      onBegin={onBegin}
      onChosen={onChosen}
      onManual={onManual}
    />,
  );
  return { onChosen, onBegin, onManual };
}
async function open() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.supported = true;
  h.get.mockResolvedValue(record("A"));
  h.assert.mockResolvedValue(undefined);
  h.subscribe.mockImplementation((listener) => {
    h.changed = listener;
    return () => {};
  });
  h.check.mockResolvedValue(undefined);
  h.pick.mockResolvedValue([{}]);
  h.read.mockResolvedValue({ markdown: "selected" });
  h.authorize.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("明确独立仓库连接，直接选择文章，不要求导出预设", async () => {
  const { onChosen } = setup();
  await open();
  expect(screen.getByText("仓库A")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  });
  expect(h.pick).toHaveBeenCalledWith(record("A"));
  expect(onChosen).toHaveBeenCalledTimes(1);
});
it("更换连接通知取消旧读取，迟到结果不交给编辑器", async () => {
  let finish!: (v: any) => void;
  h.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onChosen } = setup();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  await waitFor(() => expect(h.read).toHaveBeenCalled());
  act(() => {
    h.changed?.();
  });
  await act(async () => {
    finish({ markdown: "late" });
  });
  expect(h.read.mock.calls[0][3].aborted).toBe(true);
  expect(onChosen).not.toHaveBeenCalled();
});
it("失效权限不打开picker，明确只读重授后才可继续", async () => {
  h.check.mockRejectedValueOnce(new RepositoryReadPermissionError("prompt"));
  setup();
  await open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  });
  expect(h.pick).not.toHaveBeenCalled();
  expect(h.authorize).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "重新授权仓库（只读）" }),
    );
  });
  expect(h.authorize).toHaveBeenCalledWith(record("A"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  });
  expect(h.pick).toHaveBeenCalledTimes(1);
});
it("读取途中取消关闭，迟到结果不交给编辑器，重开可选", async () => {
  let finish!: (v: any) => void;
  h.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onChosen, onBegin } = setup();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  await waitFor(() => expect(h.read).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => {
    finish({ markdown: "late" });
  });
  expect(onChosen).not.toHaveBeenCalled();
  expect(h.read.mock.calls[0][3].aborted).toBe(true);
  await open();
  expect(onBegin).toHaveBeenCalledTimes(3);
});
it("picker取消保留原文，不调用onChosen", async () => {
  h.pick.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
  const { onChosen } = setup();
  await open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  });
  expect(screen.getByText("已取消选择文章，原文没有改变。")).toBeTruthy();
  expect(onChosen).not.toHaveBeenCalled();
});
it.each([true, false])(
  "无连接或不支持时准确说明同源边界和降级",
  async (supported) => {
    h.supported = supported;
    h.get.mockResolvedValue(undefined);
    const { onManual } = setup();
    await open();
    if (supported)
      expect(screen.getByText(/尚未连接 Obsidian 仓库/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "设置 Obsidian 仓库" })
        .getAttribute("href"),
    ).toBe("/studio/settings#obsidian-repository");
    fireEvent.click(
      screen.getByRole("button", {
        name: "仅选择单个文件（不自动读取本地附件）",
      }),
    );
    expect(onManual).toHaveBeenCalledTimes(1);
    expect(h.pick).not.toHaveBeenCalled();
  },
);
