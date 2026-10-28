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
  supported: vi.fn(),
  list: vi.fn(),
  pick: vi.fn(),
  save: vi.fn(),
  permission: vi.fn(),
  download: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../src/modules/obsidian-local/presets", () => ({
  isDirectoryPickerSupported: h.supported,
  listPresets: h.list,
  pickDirectory: h.pick,
  verifyVault: async () => true,
  putPreset: h.put,
  deletePreset: h.remove,
}));
vi.mock("../../src/modules/obsidian-local/save", () => ({
  normalizePath: (...p: string[]) => p.join("/"),
  saveToDirectory: h.save,
  LocalConflictError: class extends Error {},
  MissingDirectoryError: class extends Error {},
}));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  downloadText: h.download,
}));
import SaveButton from "../../src/modules/obsidian-local/SaveButton";
import ObsidianSettings from "../../src/modules/obsidian-local/Settings";
import {
  LocalConflictError,
  MissingDirectoryError,
} from "../../src/modules/obsidian-local/save";
const snapshot = () => ({
  articleId: "a",
  title: "当前稿",
  markdown: "正文",
  blocks: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.supported.mockReturnValue(true);
  h.permission.mockResolvedValue("granted");
  h.list.mockResolvedValue([
    {
      preset: {
        id: "p",
        name: "本地库",
        vaultName: "vault",
        noteDirectory: "笔记",
        imageRule: "../asset",
        isVault: true,
      },
      handle: { name: "vault", requestPermission: h.permission },
    },
  ]);
  h.save.mockResolvedValue({ notePath: "笔记/当前稿.md" });
});
afterEach(cleanup);
it("不支持浏览器明确只提供普通下载", async () => {
  h.supported.mockReturnValue(false);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  expect(await screen.findByText(/当前浏览器不支持/)).toBeTruthy();
  fireEvent.click(screen.getByText("仅下载 Markdown"));
  expect(h.download).toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
});
it("取消关闭不保存", async () => {
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("取消"));
  expect(h.save).not.toHaveBeenCalled();
});
it("保存当前快照并阻止连续重复写入", async () => {
  let resolve: any;
  h.save.mockImplementation(() => new Promise((r) => (resolve = r)));
  const getSnapshot = vi.fn(snapshot);
  render(<SaveButton getSnapshot={getSnapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  const button = screen.getByText("保存本次快照");
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
  expect(getSnapshot).toHaveBeenCalledTimes(1);
  resolve({ notePath: "笔记/当前稿.md" });
  expect(await screen.findByText(/已保存到本地/)).toBeTruthy();
});
it("权限失效保持错误并提供重新选目录", async () => {
  h.permission.mockResolvedValue("denied");
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存本次快照"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("选择其他位置")).toBeTruthy();
  expect(h.save).not.toHaveBeenCalled();
});
it("目录选择取消不写入且保留对话框", async () => {
  h.pick.mockRejectedValue(new DOMException("cancel", "AbortError"));
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("选择其他位置"));
  expect(await screen.findByText("已取消选择，未保存文件。")).toBeTruthy();
  expect(h.save).not.toHaveBeenCalled();
});
it("图片失败可见，未误报保存成功", async () => {
  h.save.mockRejectedValue(new Error("图片下载失败，请重试"));
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存本次快照"));
  expect(await screen.findByText("图片下载失败，请重试")).toBeTruthy();
  expect(screen.queryByText(/已保存到本地/)).toBeNull();
  expect(screen.getByText("保存本次快照")).toBeTruthy();
});

it("本地修改先提示，另存使用同一快照", async () => {
  h.save.mockRejectedValueOnce(new LocalConflictError());
  const getSnapshot = vi.fn(snapshot);
  render(<SaveButton getSnapshot={getSnapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存本次快照"));
  await screen.findByText("另存副本");
  expect(h.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("另存副本"));
  await screen.findByText(/已保存到本地/);
  expect(h.save.mock.lastCall?.[2].conflict).toBe("copy");
  expect(getSnapshot).toHaveBeenCalledTimes(1);
});
it("缺目录先等待明确创建授权", async () => {
  h.save.mockRejectedValueOnce(new MissingDirectoryError());
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存本次快照"));
  await screen.findByText("创建目录并保存");
  expect(h.save.mock.calls[0][2].createDirectories).toBe(false);
  fireEvent.click(screen.getByText("创建目录并保存"));
  await screen.findByText(/已保存到本地/);
  expect(h.save.mock.lastCall?.[2].createDirectories).toBe(true);
});
it("设置编辑预设只调用本地持久化，并可删除不删文件", async () => {
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.change(screen.getByLabelText("预设名称"), {
    target: { value: "工作笔记" },
  });
  fireEvent.click(screen.getByText("保存本地预设"));
  await screen.findByText("本地预设已保存，仅此浏览器可用。");
  expect(h.put.mock.calls[0][0]).toMatchObject({
    id: "p",
    name: "工作笔记",
    noteDirectory: "笔记",
    imageRule: "../asset",
  });
  fireEvent.click(screen.getByText("删除 本地库"));
  await screen.findByText("预设已删除，不会删除本地文章或图片。");
  expect(h.remove).toHaveBeenCalledWith("p");
});
it("设置目录选择取消不覆盖已有授权", async () => {
  h.pick.mockRejectedValue(new DOMException("cancel", "AbortError"));
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("已取消目录选择，原预设未改变。");
  expect(screen.getByText("根目录：vault")).toBeTruthy();
  expect(h.put).not.toHaveBeenCalled();
});

it("普通下载保留标题并将图片转换为同站绝对链接，而不写本地目录", async () => {
  h.supported.mockReturnValue(false);
  render(
    <SaveButton
      getSnapshot={() => ({
        ...snapshot(),
        markdown: "![图](/api/files/image-a)",
        blocks: [
          {
            type: "image",
            props: { url: "/api/files/image-a", name: "图.png" },
          },
        ],
      })}
    />,
  );
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  fireEvent.click(await screen.findByText("仅下载 Markdown"));
  expect(h.download.mock.lastCall?.[1]).toContain("# 当前稿");
  expect(h.download.mock.lastCall?.[1]).toContain(
    new URL("/api/files/image-a", window.location.origin).href,
  );
  expect(h.save).not.toHaveBeenCalled();
});

it("迟到的预设列表不能覆盖用户刚选择的临时目录", async () => {
  let resolve!: (rows: unknown[]) => void;
  h.list.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const chosen = { name: "用户刚选择的目录", requestPermission: h.permission };
  h.pick.mockResolvedValueOnce(chosen);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  fireEvent.click(screen.getByText("选择其他位置"));
  await screen.findByText(/目标：用户刚选择的目录/);
  await act(async () =>
    resolve([
      {
        preset: {
          id: "late",
          name: "迟到预设",
          vaultName: "旧目录",
          noteDirectory: "笔记",
          imageRule: "../asset",
          isVault: true,
        },
        handle: { name: "旧目录", requestPermission: h.permission },
      },
    ]),
  );
  fireEvent.click(screen.getByText("保存本次快照"));
  await waitFor(() => expect(h.save).toHaveBeenCalled());
  expect(h.save.mock.calls[0][0]).toBe(chosen);
});

// 样式接线回归不是截图验收：防止新增界面再次落回浏览器原生控件。
it.each(["light", "dark"])(
  "本地设置复用设计系统控件与主题容器：%s",
  async (mode) => {
    document.documentElement.dataset.mode = mode;
    const { container } = render(<ObsidianSettings />);
    await screen.findByText("本地库");
    for (const button of container.querySelectorAll("button"))
      expect(button.classList.contains("button")).toBe(true);
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.querySelector(".form-stack")).not.toBeNull();
    expect(container.querySelector(".form-grid")).not.toBeNull();
    expect(screen.getByText("保存本地预设").classList.contains("primary")).toBe(
      true,
    );
    expect(container.querySelector("[style]")).toBeNull();
    delete document.documentElement.dataset.mode;
  },
);
it("本地保存弹窗与fallback使用共享Modal及按钮样式", async () => {
  const { container } = render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  for (const button of container.querySelectorAll("button"))
    expect(button.matches(".button,.icon-button")).toBe(true);
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.querySelector(".modal .modal-actions")).not.toBeNull();
  expect(screen.getByText("保存本次快照").classList.contains("primary")).toBe(
    true,
  );
});
it("不支持目录授权的普通下载按钮也沿用设计系统", async () => {
  h.supported.mockReturnValue(false);
  const { container } = render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  expect(screen.getByText("仅下载 Markdown").classList.contains("button")).toBe(
    true,
  );
  for (const button of container.querySelectorAll("button"))
    expect(button.matches(".button,.icon-button")).toBe(true);
});
