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
  list: vi.fn(),
  check: vi.fn(),
  pick: vi.fn(),
  read: vi.fn(),
  authorize: vi.fn(),
  supported: true,
}));
vi.mock("../../src/modules/obsidian-local/presets", () => ({
  listPresets: h.list,
}));
vi.mock(
  "../../src/modules/markdown-import/preset-import",
  async (original) => ({
    ...(await original<object>()),
    checkPresetRead: h.check,
    pickPresetMarkdown: h.pick,
    readPresetMarkdown: h.read,
    authorizePresetRead: h.authorize,
    supportsPresetFilePicker: () => h.supported,
  }),
);
vi.mock("../../src/modules/log/client", () => ({ clientLog: vi.fn() }));
import PresetImportButton from "../../src/modules/markdown-import/PresetImportButton";
import { PresetReadPermissionError } from "../../src/modules/markdown-import/preset-import";
const record = (id: string) => ({
  preset: { id, name: "预设" + id, vaultName: "vault" + id },
  handle: {},
});
function setup() {
  const onChosen = vi.fn(async () => {}),
    onBegin = vi.fn(() => ({ request: 1, sequence: 0 })),
    onManual = vi.fn();
  render(
    <PresetImportButton
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
  h.list.mockResolvedValue([record("A")]);
  h.check.mockResolvedValue(undefined);
  h.pick.mockResolvedValue([{}]);
  h.read.mockResolvedValue({ markdown: "selected" });
  h.authorize.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("多个预设不猜第一个，明确选择后只传该预设", async () => {
  h.list.mockResolvedValue([record("A"), record("B")]);
  const { onChosen } = setup();
  await open();
  expect(
    (
      screen.getByRole("button", {
        name: "选择 Markdown 文章",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("combobox", { name: "笔记预设" }));
  fireEvent.click(screen.getByRole("option", { name: /预设B/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  });
  expect(h.pick).toHaveBeenCalledWith(record("B"));
  expect(onChosen).toHaveBeenCalledTimes(1);
});
it("失效权限不打开picker，明确只读重授后才可继续", async () => {
  h.check.mockRejectedValueOnce(new PresetReadPermissionError("prompt"));
  setup();
  await open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "选择 Markdown 文章" }));
  });
  expect(h.pick).not.toHaveBeenCalled();
  expect(h.authorize).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "重新授权此预设（只读）" }),
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
  "无预设或不支持时准确说明同源边界和降级",
  async (supported) => {
    h.supported = supported;
    h.list.mockResolvedValue([]);
    const { onManual } = setup();
    await open();
    expect(
      screen
        .getByRole("link", { name: "打开笔记预设设置" })
        .getAttribute("href"),
    ).toBe("/studio/settings");
    fireEvent.click(
      screen.getByRole("button", {
        name: "仅选择单个文件（不自动读取本地附件）",
      }),
    );
    expect(onManual).toHaveBeenCalledTimes(1);
    expect(h.pick).not.toHaveBeenCalled();
  },
);
