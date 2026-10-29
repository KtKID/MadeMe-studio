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
  verify: vi.fn(),
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
  verifyVault: h.verify,
  putPreset: h.put,
  deletePreset: h.remove,
}));
vi.mock("../../src/modules/obsidian-local/save", async (original) => ({
  ...(await original<object>()),
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
function directoryTree(name: string, vault = true): any {
  return {
    name,
    requestPermission: h.permission,
    getDirectoryHandle: async (child: string) => {
      if (child === ".obsidian") {
        if (!vault) throw new DOMException("missing", "NotFoundError");
        return { name: child };
      }
      return directoryTree(child, false);
    },
  };
}
const snapshot = () => ({
  articleId: "a",
  title: "当前稿",
  markdown: "正文",
  blocks: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.supported.mockReturnValue(true);
  h.verify.mockResolvedValue(true);
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
      handle: directoryTree("vault"),
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
  expect(screen.getByText("其他位置")).toBeTruthy();
  expect(h.save).not.toHaveBeenCalled();
});
it("目录选择取消不写入且保留对话框", async () => {
  h.pick.mockRejectedValue(new DOMException("cancel", "AbortError"));
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("其他位置"));
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
  const chosen = directoryTree("用户刚选择的目录");
  h.pick.mockResolvedValueOnce(chosen);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  fireEvent.click(screen.getByText("其他位置"));
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
        handle: directoryTree("旧目录"),
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
          ...directoryTree("vault"),
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
  await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
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
  const handle = directoryTree("vault");
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
        handle: directoryTree(rootName),
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

it("真实URI回归：授权TechNote容器内的brain仓库使用仓库相对路径，不改保存位置", async () => {
  const missing = () =>
    Promise.reject(new DOMException("missing", "NotFoundError"));
  const notes = { name: "01_笔记", getDirectoryHandle: missing };
  const brain = {
    name: "brain",
    getDirectoryHandle: async (name: string) => {
      if (name === ".obsidian") return { name };
      if (name === "01_笔记") return notes;
      return missing();
    },
  };
  const handle = {
    name: "TechNote",
    requestPermission: h.permission,
    getDirectoryHandle: async (name: string) =>
      name === "brain" ? brain : missing(),
  };
  h.list.mockResolvedValue([
    {
      preset: {
        id: "p",
        name: "笔记",
        vaultName: "TechNote",
        noteDirectory: "brain/01_笔记",
        imageRule: "../asset",
        isVault: false,
      },
      handle,
    },
  ]);
  h.save.mockResolvedValue({ notePath: "brain/01_笔记/MadeMe.md" });
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("笔记");
  fireEvent.click(screen.getByText("保存本次快照"));
  const link = await screen.findByText("在 Obsidian 中打开");
  const url = new URL(link.getAttribute("href")!);
  expect(url.searchParams.get("vault")).toBe("brain");
  // 官方允许有/无 .md 后缀；保留真实已保存文件名，不需改写磁盘文件。
  expect(url.searchParams.get("file")).toBe("01_笔记/MadeMe.md");
  expect(h.save).toHaveBeenCalledWith(
    handle,
    expect.anything(),
    expect.objectContaining({ noteDirectory: "brain/01_笔记" }),
  );
});

it("保存后打开目标探测权限失败不谎称保存失败，也不回退错误仓库", async () => {
  const handle = {
    ...directoryTree("TechNote"),
    getDirectoryHandle: async () => {
      throw new DOMException("权限失效", "NotAllowedError");
    },
  };
  h.list.mockResolvedValue([
    {
      preset: {
        id: "p",
        name: "笔记",
        vaultName: "TechNote",
        noteDirectory: "笔记",
        imageRule: "../asset",
        isVault: true,
      },
      handle,
    },
  ]);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("笔记");
  fireEvent.click(screen.getByText("保存本次快照"));
  await screen.findByText(/文件已保存，但无法确认 Obsidian 打开目标/);
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/已保存到本地目录/)).toBeTruthy();
  expect(screen.queryByText("在 Obsidian 中打开")).toBeNull();
  expect(screen.queryByText(/未同步 Obsidian/)).toBeNull();
});

it("新建预设拒绝无仓库路径，不写入配置或填入无效目录", async () => {
  h.list.mockResolvedValue([]);
  h.pick.mockResolvedValue(directoryTree("无效目录", false));
  h.verify.mockResolvedValue(false);
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("浏览选择 vault 根目录"));
  await screen.findAllByText("这个路径没有检测到 Obsidian 仓库，请重新选择");
  expect((screen.getByLabelText("预设名称") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(h.put).not.toHaveBeenCalled();
});

it("修改预设拒绝无仓库路径，保留原有效句柄和编辑输入", async () => {
  h.pick.mockResolvedValue(directoryTree("无效目录", false));
  h.verify.mockImplementation(async (handle) => handle.name === "vault");
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.change(screen.getByLabelText("预设名称"), {
    target: { value: "编辑中的名称" },
  });
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findAllByText("这个路径没有检测到 Obsidian 仓库，请重新选择");
  expect(h.put).not.toHaveBeenCalled();
  expect((screen.getByLabelText("预设名称") as HTMLInputElement).value).toBe(
    "编辑中的名称",
  );
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  await waitFor(() => expect(h.put).toHaveBeenCalled());
  expect(h.put.mock.lastCall?.[1].name).toBe("vault");
});

it("无预设时其他位置仍拒绝无仓库根，不启用保存", async () => {
  h.list.mockResolvedValue([]);
  h.pick.mockResolvedValue(directoryTree("无效目录", false));
  h.verify.mockResolvedValue(false);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("尚未选择预设，请先选择仓库根目录。");
  fireEvent.click(screen.getByText("其他位置"));
  await screen.findAllByText("这个路径没有检测到 Obsidian 仓库，请重新选择");
  expect(h.save).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
  expect((screen.getByText("保存本次快照") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("文章子目录无需仓库标记，仍可在已授权根内选择", async () => {
  const handle = { ...directoryTree("vault"), resolve: async () => ["归档"] };
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
      handle,
    },
  ]);
  h.pick.mockResolvedValue(directoryTree("归档", false));
  h.verify.mockResolvedValue(false);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("其他位置"));
  await screen.findByText(/目标：vault\/归档/);
  expect(h.verify).not.toHaveBeenCalled();
  expect(
    screen.queryByText("这个路径没有检测到 Obsidian 仓库，请重新选择"),
  ).toBeNull();
});

it.each(["NotAllowedError", "NotReadableError"])(
  "根选择 %s 不伪装为无仓库且保留旧预设",
  async (name) => {
    h.pick.mockResolvedValue(directoryTree("新目录"));
    h.verify.mockImplementation(async (handle) => {
      if (handle.name !== "vault") throw new DOMException("读取目录失败", name);
      return true;
    });
    render(<ObsidianSettings />);
    fireEvent.click(await screen.findByText("编辑 本地库"));
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    await screen.findByText(/读取目录失败|本地预设操作失败/);
    expect(
      screen.queryByText("这个路径没有检测到 Obsidian 仓库，请重新选择"),
    ).toBeNull();
    expect(h.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect(h.put.mock.lastCall?.[1].name).toBe("vault");
  },
);

it.each([true, false])(
  "旧预设 isVault=%s 未重新Browse也必须在确认保存前校验真实仓库",
  async (isVault) => {
    h.list.mockResolvedValue([
      {
        preset: {
          id: "p",
          name: "本地库",
          vaultName: "vault",
          noteDirectory: "笔记",
          imageRule: "../asset",
          isVault,
        },
        handle: directoryTree("vault"),
      },
    ]);
    h.verify.mockResolvedValue(false);
    render(<ObsidianSettings />);
    fireEvent.click(await screen.findByText("编辑 本地库"));
    fireEvent.change(screen.getByLabelText("预设名称"), {
      target: { value: "未保存的新名称" },
    });
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await screen.findAllByText("这个路径没有检测到 Obsidian 仓库，请重新选择");
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.permission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("取消"));
    expect((screen.getByLabelText("预设名称") as HTMLInputElement).value).toBe(
      "未保存的新名称",
    );
  },
);

it("Browse通过后标记被移除，确认时重新校验且不保存本次路径", async () => {
  h.pick.mockResolvedValue(directoryTree("新仓库"));
  h.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录：新仓库");
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  await screen.findAllByText("这个路径没有检测到 Obsidian 仓库，请重新选择");
  expect(h.verify).toHaveBeenCalledTimes(2);
  expect(h.put).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
});

it.each(["NotAllowedError", "NotReadableError"])(
  "确认时 %s 不吞掉且不写配置，重选有效仓库可保存",
  async (name) => {
    h.verify.mockRejectedValueOnce(new DOMException("无法读取仓库", name));
    render(<ObsidianSettings />);
    fireEvent.click(await screen.findByText("编辑 本地库"));
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await screen.findAllByText(/无法读取仓库|本地预设操作失败/);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
    expect(
      screen.queryByText("这个路径没有检测到 Obsidian 仓库，请重新选择"),
    ).toBeNull();
    fireEvent.click(screen.getByText("取消"));
    h.pick.mockResolvedValue(directoryTree("有效仓库"));
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    await screen.findByText("根目录：有效仓库");
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.lastCall?.[1].name).toBe("有效仓库");
    expect(h.permission).not.toHaveBeenCalled();
  },
);

it("预设文章子目录由选择目录按钮打开picker更新，字段只读且保存相对路径", async () => {
  const handle = {
    ...directoryTree("vault"),
    resolve: vi.fn(async () => ["归档", "文章"]),
  };
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
      handle,
    },
  ]);
  const child = directoryTree("文章", false);
  h.pick.mockResolvedValue(child);
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  const input = screen.getByLabelText("默认文章子目录") as HTMLInputElement;
  expect(input.readOnly).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() => expect(input.value).toBe("归档/文章"));
  expect(h.pick).toHaveBeenCalledWith(handle);
  expect(handle.resolve).toHaveBeenCalledWith(child);
  expect(h.verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  await waitFor(() => expect(h.put).toHaveBeenCalled());
  expect(h.put.mock.lastCall?.[0].noteDirectory).toBe("归档/文章");
});

it("保存弹窗仅保留一个其他位置入口，与目标同行并保留主操作", async () => {
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  const button = screen.getByRole("button", { name: "其他位置" });
  expect(button.parentElement?.textContent).toContain("目标：vault/笔记");
  expect(screen.queryByText("浏览文章子目录")).toBeNull();
  expect(screen.queryByText("选择其他位置")).toBeNull();
  expect(screen.getByText("取消").closest(".modal-actions")).toBeTruthy();
  expect(
    screen.getByText("保存本次快照").closest(".modal-actions"),
  ).toBeTruthy();
});

it.each(["cancel", "outside", "permission", "image-rule"])(
  "预设子目录选择 %s 保留原值并反馈，不写入配置",
  async (mode) => {
    const handle = {
      ...directoryTree("vault"),
      resolve: async () => (mode === "image-rule" ? [] : null),
    };
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
        handle,
      },
    ]);
    if (mode === "cancel")
      h.pick.mockRejectedValue(new DOMException("取消", "AbortError"));
    else if (mode === "permission")
      h.pick.mockRejectedValue(new DOMException("拒绝", "NotAllowedError"));
    else h.pick.mockResolvedValue(directoryTree("根外目录", false));
    render(<ObsidianSettings />);
    fireEvent.click(await screen.findByText("编辑 本地库"));
    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    await screen.findByText(
      mode === "cancel"
        ? "已取消目录选择，原文章子目录未改变。"
        : mode === "outside"
          ? "文章目录必须位于已授权根目录内。"
          : mode === "image-rule"
            ? "图片规则越出了授权根目录。"
            : /拒绝|本地预设操作失败/,
    );
    expect(
      (screen.getByLabelText("默认文章子目录") as HTMLInputElement).value,
    ).toBe("笔记");
    expect(h.put).not.toHaveBeenCalled();
    expect(h.permission).not.toHaveBeenCalled();
  },
);

it("未选择根时子目录选择不可用；选择中锁定按钮，重复点击只打开一次", async () => {
  h.list.mockResolvedValue([]);
  const handle = { ...directoryTree("vault"), resolve: async () => ["归档"] };
  render(<ObsidianSettings />);
  expect(
    (
      screen.getByRole("button", {
        name: "选择目录",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  h.pick.mockResolvedValueOnce(handle);
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录：vault");
  let finish!: (value: unknown) => void;
  h.pick.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const button = screen.getByRole("button", { name: "选择目录" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(h.pick).toHaveBeenCalledTimes(2);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(directoryTree("归档", false)));
  expect(
    (screen.getByLabelText("默认文章子目录") as HTMLInputElement).value,
  ).toBe("归档");
});

it("预设路径和选择目录在同一可换行控制组，图片规则仍为另一列", async () => {
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 本地库"));
  const input = screen.getByLabelText("默认文章子目录");
  const button = screen.getByRole("button", { name: "选择目录" });
  expect(input.parentElement).toBe(button.parentElement);
  expect(
    input.parentElement?.classList.contains("obsidian-directory-control"),
  ).toBe(true);
  expect(input.closest(".form-grid")?.children).toHaveLength(2);
  expect(
    screen.getByLabelText("图片规则（相对文章目录）").closest("label"),
  ).not.toBe(input.closest("label"));
});
