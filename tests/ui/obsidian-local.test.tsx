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
  await screen.findByRole("dialog", { name: "是否保存此预设？" });
  expect(h.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("确认保存预设"));
  await screen.findByText("本地预设已保存，仅此浏览器可用。");
  expect(h.permission).not.toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
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
  const { baseElement } = render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  for (const button of baseElement.querySelectorAll("button"))
    expect(button.matches(".button,.icon-button")).toBe(true);
  expect(baseElement.querySelector("dialog")).toBeNull();
  expect(baseElement.querySelector(".modal .modal-actions")).not.toBeNull();
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

it.each(["granted", "denied", "prompt"])(
  "实际保存前查询写权限，不无条件请求：%s",
  async (state) => {
    const query = vi.fn().mockResolvedValue(state);
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
        handle: {
          name: "vault",
          queryPermission: query,
          requestPermission: h.permission,
        },
      },
    ]);
    render(<SaveButton getSnapshot={snapshot} />);
    fireEvent.click(screen.getByText("保存到 Obsidian"));
    await screen.findByText("本地库");
    expect(query).not.toHaveBeenCalled();
    expect(h.permission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("保存本次快照"));
    if (state === "denied") {
      await screen.findByText(/写入权限已被拒绝/);
      expect(h.save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText("保存本次快照"));
      await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
      expect(h.permission).not.toHaveBeenCalled();
    } else {
      await screen.findByText(/已保存到本地/);
      expect(h.permission).toHaveBeenCalledTimes(state === "prompt" ? 1 : 0);
    }
    expect(query).toHaveBeenCalledWith({ mode: "readwrite" });
  },
);

it("取消站内预设保存确认保留编辑输入，不请求系统写权限", async () => {
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.change(screen.getByLabelText("预设名称"), {
    target: { value: "待确认的新名称" },
  });
  fireEvent.click(screen.getByText("保存本地预设"));
  await screen.findByRole("dialog", { name: "是否保存此预设？" });
  expect(screen.getByText("待确认的新名称")).toBeTruthy();
  fireEvent.click(screen.getByText("取消"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByLabelText("预设名称") as HTMLInputElement).value).toBe(
    "待确认的新名称",
  );
  expect(h.put).not.toHaveBeenCalled();
  expect(h.permission).not.toHaveBeenCalled();
});
it("重复确认只保存一次，失败留在站内确认框且可重试", async () => {
  let reject!: (error: Error) => void;
  h.put.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  fireEvent.click(screen.getByText("确认保存预设"));
  expect(h.put).toHaveBeenCalledTimes(1);
  expect((screen.getByText("取消") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error("本地数据库保存失败")));
  const dialog = screen.getByRole("dialog", { name: "是否保存此预设？" });
  expect(dialog.textContent).toContain("本地数据库保存失败");
  expect((screen.getByText("确认保存预设") as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByText("确认保存预设"));
  await screen.findByText("本地预设已保存，仅此浏览器可用。");
  expect(h.put).toHaveBeenCalledTimes(2);
  expect(h.permission).not.toHaveBeenCalled();
});

it("恢复原打开入口，不要求填写额外字段或显示前置提示", async () => {
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存本次快照"));
  const link = await screen.findByText("在 Obsidian 中打开");
  const url = new URL(link.getAttribute("href")!);
  expect(url.searchParams.get("vault")).toBe("vault");
  expect(url.searchParams.get("file")).toBe("笔记/当前稿.md");
  expect(screen.queryByText(/尚未确认|不提供打开链接|已登记仓库/)).toBeNull();
  expect(screen.queryByText("复制本地相对路径")).toBeNull();
  expect(screen.getByText(/已保存到本地目录/)).toBeTruthy();
});
it("预设流程不再显示额外登记身份输入、根确认和打开限制摘要", async () => {
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  expect(screen.queryByLabelText(/已登记仓库/)).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByText("保存本地预设"));
  const dialog = await screen.findByRole("dialog", {
    name: "是否保存此预设？",
  });
  expect(dialog.textContent).not.toMatch(/打开目标|未配置或未确认|登记仓库/);
});
it("编辑旧配置兼容保留已存字段，不删除目录句柄或历史参数", async () => {
  const handle = { name: "vault", requestPermission: h.permission };
  h.list.mockResolvedValue([
    {
      preset: {
        id: "p",
        name: "本地库",
        vaultName: "vault",
        obsidianVault: "历史值",
        vaultRootConfirmed: true,
        noteDirectory: "笔记",
        imageRule: "../asset",
        isVault: true,
      },
      handle,
    },
  ]);
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.change(screen.getByLabelText("预设名称"), {
    target: { value: "改名" },
  });
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  await screen.findByText("本地预设已保存，仅此浏览器可用。");
  expect(h.put.mock.calls[0][0]).toMatchObject({
    id: "p",
    name: "改名",
    obsidianVault: "历史值",
    vaultRootConfirmed: true,
    noteDirectory: "笔记",
    imageRule: "../asset",
  });
  expect(h.put.mock.calls[0][1]).toBe(handle);
});

it("只有打开保存面板的文字入口带无底色悬停标记", async () => {
  const { container } = render(<SaveButton getSnapshot={snapshot} />);
  const trigger = screen.getByText("保存到 Obsidian");
  expect(trigger.classList.contains("obsidian-save-trigger")).toBe(true);
  fireEvent.click(trigger);
  await screen.findByText("本地库");
  expect(container.querySelectorAll(".obsidian-save-trigger")).toHaveLength(1);
  expect(
    screen
      .getByText("保存本次快照")
      .classList.contains("obsidian-save-trigger"),
  ).toBe(false);
});

it("保存Modal脱离快捷栏DOM，保留焦点陷阱、遮罩/Escape关闭和恢复焦点", async () => {
  const { unmount } = render(
    <div className="writing-shortcuts">
      <SaveButton getSnapshot={snapshot} />
    </div>,
  );
  const trigger = screen.getByText("保存到 Obsidian");
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByText("本地库");
  let dialog = screen.getByRole("dialog");
  expect(dialog.closest(".writing-shortcuts")).toBeNull();
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  const buttons = dialog.querySelectorAll<HTMLButtonElement>(
    "button:not(:disabled)",
  );
  buttons[buttons.length - 1].focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("dialog");
  dialog = screen.getByRole("dialog");
  fireEvent.click(dialog.parentElement!);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("dialog");
  unmount();
  expect(document.querySelector(".modal-backdrop")).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
});

it.each([
  ["TechNote", "brain/01_笔记/MadeMe.md"],
  ["中文 & + % 仓库", "brain/01_笔记/问 & + %.md"],
])(
  "打开链路诊断：真实DOM与点击保留 %s 的URI，不使用历史预设名",
  async (rootName, notePath) => {
    const { editorLinkDestination } =
      await import("../../src/components/editor/editor-navigation");
    const { installUnsavedGuard } =
      await import("../../src/components/shared/unsaved-guard");
    h.list.mockResolvedValue([
      {
        preset: {
          id: "legacy",
          name: "显示预设不是仓库",
          vaultName: "过期目录名",
          obsidianVault: "已撤销的历史身份",
          vaultRootConfirmed: false,
          noteDirectory: "brain/01_笔记",
          imageRule: "../asset",
          isVault: true,
        },
        handle: { name: rootName, requestPermission: h.permission },
      },
    ]);
    h.save.mockResolvedValue({ notePath });
    render(<SaveButton getSnapshot={snapshot} />);
    fireEvent.click(screen.getByText("保存到 Obsidian"));
    await screen.findByText("显示预设不是仓库");
    fireEvent.click(screen.getByText("保存本次快照"));
    const link = (await screen.findByText(
      "在 Obsidian 中打开",
    )) as HTMLAnchorElement;
    const expected = `obsidian://open?vault=${encodeURIComponent(rootName)}&file=${encodeURIComponent(notePath)}`;
    expect(link.getAttribute("href")).toBe(expected);
    expect(link.href).toBe(expected);
    const confirm = vi.fn(() => false);
    const stopGuard = installUnsavedGuard(window, {
      documentTarget: document,
      confirmLeave: confirm,
      currentUrl: () => window.location.href,
    });
    const destinations: (string | undefined)[] = [];
    const editorCapture = (event: MouseEvent) => {
      destinations.push(editorLinkDestination(event, window.location.href));
    };
    document.addEventListener("click", editorCapture, true);
    // 只派发DOM事件，不调用浏览器/操作系统协议处理器；jsdom不能验收原生Obsidian。
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    try {
      fireEvent(link, event);
      expect(event.defaultPrevented).toBe(false);
      expect(destinations).toEqual([undefined]);
      expect(confirm).not.toHaveBeenCalled();
      expect(link.href).toBe(expected);
      expect(
        screen.getByRole("dialog", { name: "保存到 Obsidian" }),
      ).toBeTruthy();
    } finally {
      document.removeEventListener("click", editorCapture, true);
      stopGuard();
    }
  },
);
