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
    resolve: async () => ["笔记"],
    getDirectoryHandle: async (child: string) => {
      if (child === ".obsidian") {
        if (!vault) throw new DOMException("missing", "NotFoundError");
        return { name: child };
      }
      return directoryTree(child, false);
    },
  };
}
async function selectPresetNoteDirectory() {
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("默认文章子目录") as HTMLInputElement).value,
    ).toBe("笔记"),
  );
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
  fireEvent.click(screen.getByText("下载 Markdown 文件"));
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
  const button = screen.getByText("保存");
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
  fireEvent.click(screen.getByText("保存"));
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
  fireEvent.click(screen.getByText("保存"));
  expect(await screen.findByText("图片下载失败，请重试")).toBeTruthy();
  expect(screen.queryByText(/已保存到本地/)).toBeNull();
  expect(screen.getByText("保存")).toBeTruthy();
});

it("本地修改先提示，另存使用同一快照", async () => {
  h.save.mockRejectedValueOnce(new LocalConflictError());
  const getSnapshot = vi.fn(snapshot);
  render(<SaveButton getSnapshot={getSnapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存"));
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
  fireEvent.click(screen.getByText("保存"));
  await screen.findByText("创建目录并保存");
  expect(h.save.mock.calls[0][2].createDirectories).toBe(false);
  fireEvent.click(screen.getByText("创建目录并保存"));
  await screen.findByText(/已保存到本地/);
  expect(h.save.mock.lastCall?.[2].createDirectories).toBe(true);
});
it("设置编辑预设只调用本地持久化，并可删除不删文件", async () => {
  render(<ObsidianSettings />);
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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
  fireEvent.click(await screen.findByText("下载 Markdown 文件"));
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
  fireEvent.click(screen.getByText("保存"));
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
  // 共享下拉触发器是 combobox，不是操作按钮，样式由 Dropdown 统一管理。
  for (const button of baseElement.querySelectorAll("button:not([role=combobox])"))
    expect(button.matches(".button,.icon-button")).toBe(true);
  expect(baseElement.querySelector("select")).toBeNull();
  expect(baseElement.querySelector("dialog")).toBeNull();
  expect(baseElement.querySelector(".modal .modal-actions")).not.toBeNull();
  expect(screen.getByText("保存").classList.contains("primary")).toBe(true);
});
it("不支持目录授权的普通下载按钮也沿用设计系统", async () => {
  h.supported.mockReturnValue(false);
  const { container } = render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  expect(
    screen.getByText("下载 Markdown 文件").classList.contains("button"),
  ).toBe(true);
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
    fireEvent.click(screen.getByText("保存"));
    if (state === "denied") {
      await screen.findByText(/写入权限已被拒绝/);
      expect(h.save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText("保存"));
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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
  fireEvent.click(screen.getByText("保存"));
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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
    screen.getByText("保存").classList.contains("obsidian-save-trigger"),
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
    fireEvent.click(screen.getByText("保存"));
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
        screen.queryByRole("dialog", { name: "保存到 Obsidian" }),
      ).toBeNull();
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
  fireEvent.click(screen.getByText("保存"));
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
  fireEvent.click(screen.getByText("保存"));
  await screen.findByText(/暂无法确认打开目标/);
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
  await screen.findAllByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
  fireEvent.change(screen.getByLabelText("预设名称"), {
    target: { value: "编辑中的名称" },
  });
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findAllByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
  expect(h.put).not.toHaveBeenCalled();
  expect((screen.getByLabelText("预设名称") as HTMLInputElement).value).toBe(
    "编辑中的名称",
  );
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  h.pick.mockResolvedValue(directoryTree("vault"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录存在 .obsidian 目录，校验通过。");
  await selectPresetNoteDirectory();
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
  expect((screen.getByText("保存") as HTMLButtonElement).disabled).toBe(true);
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
    screen.queryByText("当前路径没有检测到 Obsidian 仓库，请重新选择"),
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
    await screen.findByText("编辑 本地库");
    await act(async () => {
      fireEvent.click(screen.getByText("编辑 本地库"));
    });
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    await screen.findByText(/读取目录失败|本地预设操作失败/);
    expect(
      screen.queryByText("当前路径没有检测到 Obsidian 仓库，请重新选择"),
    ).toBeNull();
    expect(h.put).not.toHaveBeenCalled();
    h.pick.mockResolvedValue(directoryTree("vault"));
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    await screen.findByText("根目录存在 .obsidian 目录，校验通过。");
    await selectPresetNoteDirectory();
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
    h.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<ObsidianSettings />);
    await screen.findByText("编辑 本地库");
    await act(async () => {
      fireEvent.click(screen.getByText("编辑 本地库"));
    });
    fireEvent.change(screen.getByLabelText("预设名称"), {
      target: { value: "未保存的新名称" },
    });
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await screen.findAllByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
    expect(h.verify).toHaveBeenCalledTimes(2);
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
  h.verify
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  render(<ObsidianSettings />);
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录：新仓库");
  await selectPresetNoteDirectory();
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  await screen.findAllByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
  expect(h.verify).toHaveBeenCalledTimes(3);
  expect(h.put).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
});

it.each(["NotAllowedError", "NotReadableError"])(
  "确认时 %s 不吞掉且不写配置，重选有效仓库可保存",
  async (name) => {
    h.verify
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new DOMException("无法读取仓库", name));
    render(<ObsidianSettings />);
    await screen.findByText("编辑 本地库");
    await act(async () => {
      fireEvent.click(screen.getByText("编辑 本地库"));
    });
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await screen.findAllByText(/无法读取仓库|本地预设操作失败/);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
    expect(
      screen.queryByText("当前路径没有检测到 Obsidian 仓库，请重新选择"),
    ).toBeNull();
    fireEvent.click(screen.getByText("取消"));
    h.pick.mockResolvedValue(directoryTree("有效仓库"));
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    await screen.findByText("根目录：有效仓库");
    await selectPresetNoteDirectory();
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
  const input = screen.getByLabelText("默认文章子目录") as HTMLInputElement;
  expect(input.readOnly).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() => expect(input.value).toBe("归档/文章"));
  expect(h.pick).toHaveBeenCalledWith(handle);
  expect(handle.resolve).toHaveBeenCalledWith(child);
  expect(h.verify).toHaveBeenCalledTimes(1);
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
  expect(screen.getByText("保存").closest(".modal-actions")).toBeTruthy();
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
    await screen.findByText("编辑 本地库");
    await act(async () => {
      fireEvent.click(screen.getByText("编辑 本地库"));
    });
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
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
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

it("仅下载Markdown是默认未选checkbox，勾选后同目录保存且不触发普通下载", async () => {
  render(
    <SaveButton
      getSnapshot={() => ({
        ...snapshot(),
        markdown: "![图](/api/files/a)",
        blocks: [
          { type: "image", props: { url: "/api/files/a", name: "图.png" } },
        ],
      })}
    />,
  );
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  const checkbox = screen.getByRole("checkbox", {
    name: "仅下载 Markdown",
  }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  expect(screen.queryByRole("button", { name: "仅下载 Markdown" })).toBeNull();
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(h.save).toHaveBeenCalled());
  expect(h.save.mock.lastCall?.[0].name).toBe("vault");
  expect(h.save.mock.lastCall?.[2]).toMatchObject({
    markdownOnly: true,
    noteDirectory: "笔记",
  });
  expect(h.save.mock.lastCall?.[1].markdown).toContain(
    new URL("/api/files/a", window.location.origin).href,
  );
  expect(h.download).not.toHaveBeenCalled();
  expect(h.pick).not.toHaveBeenCalled();
});

it("Markdown选项切换预设保留，busy禁止切换和重复保存，关闭重开恢复默认", async () => {
  const record = (id: string) => ({
    preset: {
      id,
      name: id,
      vaultName: id,
      noteDirectory: "笔记",
      imageRule: "../asset",
      isVault: true,
    },
    handle: directoryTree(id),
  });
  h.list.mockResolvedValue([record("库A"), record("库B")]);
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("库A");
  const checkbox = screen.getByRole("checkbox", {
    name: "仅下载 Markdown",
  }) as HTMLInputElement;
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("combobox", { name: "保存预设" }));
  fireEvent.click(screen.getByRole("option", { name: "库B" }));
  expect(checkbox.checked).toBe(true);
  let finish!: (value: unknown) => void;
  h.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const save = screen.getByRole("button", { name: "保存" });
  const actions = save.closest(".modal-actions")!;
  expect(Array.from(actions.children).map((node) => node.textContent)).toEqual([
    "仅下载 Markdown",
    "取消",
    "保存",
  ]);
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
  expect(checkbox.disabled).toBe(true);
  expect(h.save.mock.lastCall?.[0].name).toBe("库B");
  expect(h.save.mock.lastCall?.[2].markdownOnly).toBe(true);
  await act(async () => finish({ notePath: "笔记/a.md" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("库A");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByText("保存"));
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
  expect(h.save.mock.lastCall?.[2].markdownOnly).toBe(false);
  expect(h.download).not.toHaveBeenCalled();
});

it.each([false, true])(
  "确认旧预设以真实根检查拒绝无标记目录，缓存 isVault=%s",
  async (isVault) => {
    const actual = await vi.importActual<
      typeof import("../../src/modules/obsidian-local/presets")
    >("../../src/modules/obsidian-local/presets");
    h.verify.mockImplementation(actual.verifyVault);
    h.list.mockResolvedValue([
      {
        preset: {
          id: "old",
          name: "旧库",
          vaultName: "TechNote",
          noteDirectory: "brain/01_笔记",
          imageRule: "../asset",
          isVault,
        },
        handle: {
          ...directoryTree("TechNote", false),
          getDirectoryHandle: async () => {
            throw Object.assign(new Error("missing"), {
              name: "NotFoundError",
            });
          },
        },
      },
    ]);
    render(<ObsidianSettings />);
    await screen.findByText("编辑 旧库");
    await act(async () => {
      fireEvent.click(screen.getByText("编辑 旧库"));
    });
    expect(
      (screen.getByText("保存本地预设") as HTMLButtonElement).disabled,
    ).toBe(true);
    await screen.findAllByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
    expect(h.put).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  },
);

it.each(["NotFoundError", "TypeMismatchError", "NotAllowedError"])(
  "真实根 Browse 的 %s 拒绝本次目录，子 brain 标记不替代根标记",
  async (name) => {
    const actual = await vi.importActual<
      typeof import("../../src/modules/obsidian-local/presets")
    >("../../src/modules/obsidian-local/presets");
    h.verify.mockImplementation(actual.verifyVault);
    const getDirectoryHandle = vi.fn(async (child: string) => {
      if (child === ".obsidian")
        throw Object.assign(new Error("根检查失败"), { name });
      if (child === "brain") return directoryTree("brain", true);
      throw new Error("不应扫描其它目录");
    });
    h.pick.mockResolvedValue({
      ...directoryTree("TechNote"),
      getDirectoryHandle,
    });
    render(<ObsidianSettings />);
    await screen.findByText("编辑 本地库");
    await act(async () => {
      fireEvent.click(screen.getByText("编辑 本地库"));
    });
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    await screen.findAllByText(
      name === "NotFoundError"
        ? "当前路径没有检测到 Obsidian 仓库，请重新选择"
        : "根检查失败",
    );
    expect(getDirectoryHandle).toHaveBeenCalledExactlyOnceWith(".obsidian", {
      create: false,
    });
    expect(screen.getByText("根目录：vault")).toBeTruthy();
    expect(screen.queryByText("根目录：TechNote")).toBeNull();
    expect(h.put).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  },
);

it("真实根 Browse 新建拒绝缺标记目录，不能保存无效选择", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/obsidian-local/presets")
  >("../../src/modules/obsidian-local/presets");
  h.verify.mockImplementation(actual.verifyVault);
  h.list.mockResolvedValue([]);
  h.pick.mockResolvedValue({
    ...directoryTree("TechNote"),
    getDirectoryHandle: async () => {
      throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    },
  });
  render(<ObsidianSettings />);
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findAllByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(h.put).not.toHaveBeenCalled();
});

it("真实根 Browse 等待时重复点击只选一次，取消保留原路径", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/obsidian-local/presets")
  >("../../src/modules/obsidian-local/presets");
  h.verify.mockImplementation(actual.verifyVault);
  let reject!: (error: unknown) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  render(<ObsidianSettings />);
  await screen.findByText("编辑 本地库");
  await act(async () => {
    fireEvent.click(screen.getByText("编辑 本地库"));
  });
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  expect(h.pick).toHaveBeenCalledTimes(1);
  await act(async () => reject(new DOMException("cancel", "AbortError")));
  await screen.findByText("已取消目录选择，原预设未改变。");
  expect(screen.getByText("根目录：vault")).toBeTruthy();
  expect(h.verify).toHaveBeenCalledTimes(1);
  expect(h.put).not.toHaveBeenCalled();
});

it.each([true, false])(
  "根选择失败就近只显示一句反馈，旧路径=%s",
  async (hasOld) => {
    if (!hasOld) h.list.mockResolvedValue([]);
    h.pick.mockResolvedValue(directoryTree("无效"));
    h.verify.mockResolvedValue(false);
    render(<ObsidianSettings />);
    if (hasOld) {
      await screen.findByText("编辑 本地库");
      await act(async () => {
        fireEvent.click(screen.getByText("编辑 本地库"));
      });
    }
    fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
    const notice = await screen.findByText(
      "当前路径没有检测到 Obsidian 仓库，请重新选择",
    );
    const row = screen.getByText("浏览选择 vault 根目录").parentElement!;
    expect(row.nextElementSibling?.contains(notice)).toBe(true);
    expect(h.put).not.toHaveBeenCalled();
  },
);

it("新建根选择强制可见校验中到成功，完成前不能保存", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/obsidian-local/presets")
  >("../../src/modules/obsidian-local/presets");
  h.verify.mockImplementation(actual.verifyVault);
  h.list.mockResolvedValue([]);
  let finish!: (value: unknown) => void;
  h.pick.mockResolvedValue({
    ...directoryTree("新库"),
    getDirectoryHandle: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  render(<ObsidianSettings />);
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("校验中…");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => finish({ name: ".obsidian" }));
  await screen.findByText("根目录存在 .obsidian 目录，校验通过。");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("设置布局将列表操作与保存靠右，根校验位于独立路径组", async () => {
  render(<ObsidianSettings />);
  const edit = await screen.findByText("编辑 本地库");
  expect(edit.closest(".obsidian-preset-row")).toBeTruthy();
  expect(
    screen.getByText("浏览选择 vault 根目录").closest(".obsidian-root-group"),
  ).toBeTruthy();
  expect(
    screen
      .getByText("保存本地预设")
      .parentElement?.classList.contains("obsidian-preset-actions"),
  ).toBe(true);
});

it("真实旧预设进入编辑不能信缓存，校验完成前禁用保存；新增清除状态", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/obsidian-local/presets")
  >("../../src/modules/obsidian-local/presets");
  h.verify.mockImplementation(actual.verifyVault);
  let finish!: (value: unknown) => void;
  h.list.mockResolvedValue([
    {
      preset: {
        id: "old",
        name: "旧库",
        vaultName: "vault",
        noteDirectory: "笔记",
        imageRule: "../asset",
        isVault: true,
      },
      handle: {
        ...directoryTree("vault"),
        getDirectoryHandle: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    },
  ]);
  render(<ObsidianSettings />);
  fireEvent.click(await screen.findByText("编辑 旧库"));
  await screen.findByText("校验中…");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => finish({ name: ".obsidian" }));
  await screen.findByText("根目录存在 .obsidian 目录，校验通过。");
  fireEvent.click(screen.getByText("新增预设"));
  expect(
    screen.queryByText("根目录存在 .obsidian 目录，校验通过。"),
  ).toBeNull();
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("真实新根 Browse 通过后标记消失，确认再次校验拒绝且撤下成功状态", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/obsidian-local/presets")
  >("../../src/modules/obsidian-local/presets");
  h.verify.mockImplementation(actual.verifyVault);
  h.list.mockResolvedValue([]);
  let exists = true;
  h.pick.mockResolvedValue({
    ...directoryTree("新库"),
    resolve: async () => ["01_笔记"],
    getDirectoryHandle: async () => {
      if (!exists)
        throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      return { name: ".obsidian" };
    },
  });
  render(<ObsidianSettings />);
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录存在 .obsidian 目录，校验通过。");
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("默认文章子目录") as HTMLInputElement).value,
    ).toBe("01_笔记"),
  );
  fireEvent.click(screen.getByText("保存本地预设"));
  exists = false;
  fireEvent.click(await screen.findByText("确认保存预设"));
  await screen.findByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(
    screen.queryByText("根目录存在 .obsidian 目录，校验通过。"),
  ).toBeNull();
  expect(h.put).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
});

it("根缺标记只显示用户指定一句提示，不附加重复解释", async () => {
  h.list.mockResolvedValue([]);
  h.pick.mockResolvedValue(directoryTree("无效"));
  h.verify.mockResolvedValue(false);
  render(<ObsidianSettings />);
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toBe(
    "当前路径没有检测到 Obsidian 仓库，请重新选择",
  );
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

it("缺目录后仅保留创建并保存主操作，完成关闭并保留编辑器打开入口", async () => {
  h.save.mockRejectedValueOnce(new MissingDirectoryError());
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存"));
  await screen.findByText("创建目录并保存");
  expect(screen.queryByRole("button", { name: /^保存$/ })).toBeNull();
  fireEvent.click(screen.getByText("创建目录并保存"));
  const link = await screen.findByText("在 Obsidian 中打开");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(link.closest('[role="dialog"]')).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("已保存到本地");
});

it("图片缺失显示具体解析目标，取消不授权创建", async () => {
  h.save.mockRejectedValueOnce(new MissingDirectoryError("images", "asset"));
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存"));
  await screen.findByText("图片目录 vault/asset 不存在。");
  fireEvent.click(screen.getByText("取消"));
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(h.save.mock.lastCall?.[2].createDirectories).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("创建并保存中媒体失败留在面板可重试，不错误报告成功或残留创建按钮", async () => {
  h.save
    .mockRejectedValueOnce(new MissingDirectoryError("images", "asset"))
    .mockRejectedValueOnce(new Error("图片下载失败"));
  render(<SaveButton getSnapshot={snapshot} />);
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存"));
  fireEvent.click(await screen.findByText("创建目录并保存"));
  await screen.findByText("图片下载失败");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("创建目录并保存")).toBeNull();
  fireEvent.click(screen.getByText("保存"));
  await screen.findByRole("status");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(h.save).toHaveBeenCalledTimes(3);
});

it("打开目标探测延迟不阻塞关闭与再次保存，迟到结果不污染新面板", async () => {
  let finish!: (value: unknown) => void;
  const handle = {
    ...directoryTree("vault"),
    getDirectoryHandle: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
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
  render(<SaveButton getSnapshot={snapshot} />);
  const trigger = screen.getByText("保存到 Obsidian");
  fireEvent.click(trigger);
  await screen.findByText("本地库");
  fireEvent.click(screen.getByText("保存"));
  await screen.findByRole("status");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((trigger as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(trigger);
  await screen.findByRole("dialog");
  await act(async () => finish(directoryTree("笔记")));
  expect(screen.queryByText("在 Obsidian 中打开")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByText("保存") as HTMLButtonElement).disabled).toBe(false);
});

it("新增预设子目录真正未选，根通过后仍禁用保存，选择子目录后才可确认", async () => {
  h.list.mockResolvedValue([]);
  const root = { ...directoryTree("新库"), resolve: async () => ["01_笔记"] };
  h.pick
    .mockResolvedValueOnce(root)
    .mockResolvedValueOnce(directoryTree("01_笔记", false));
  render(<ObsidianSettings />);
  const input = screen.getByLabelText("默认文章子目录") as HTMLInputElement;
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("请选择目录");
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录存在 .obsidian 目录，校验通过。");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(h.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() => expect(input.value).toBe("01_笔记"));
  fireEvent.click(screen.getByText("保存本地预设"));
  fireEvent.click(await screen.findByText("确认保存预设"));
  await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
  expect(h.put.mock.lastCall?.[0]).toMatchObject({
    noteDirectory: "01_笔记",
    imageRule: "../asset",
  });
  fireEvent.click(screen.getByText("新增预设"));
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("请选择目录");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it.each(["已有目录", ""])(
  "编辑旧预设保留明确路径 %s，不迁移为未选择",
  async (noteDirectory) => {
    h.list.mockResolvedValue([
      {
        preset: {
          id: "old",
          name: "旧库",
          vaultName: "vault",
          noteDirectory,
          imageRule: ".",
          isVault: true,
        },
        handle: directoryTree("vault"),
      },
    ]);
    render(<ObsidianSettings />);
    const edit = await screen.findByText("编辑 旧库");
    await act(async () => fireEvent.click(edit));
    const input = screen.getByLabelText("默认文章子目录") as HTMLInputElement;
    expect(input.value).toBe(noteDirectory || "（仓库根目录）");
    expect(
      (screen.getByText("保存本地预设") as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByText("保存本地预设"));
    fireEvent.click(await screen.findByText("确认保存预设"));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.lastCall?.[0].noteDirectory).toBe(noteDirectory);
    expect(h.pick).not.toHaveBeenCalled();
  },
);

it("更换有效仓库根后不能沿用旧根的子目录选择，取消或校验失败不丢原选择", async () => {
  render(<ObsidianSettings />);
  const edit = await screen.findByText("编辑 本地库");
  await act(async () => fireEvent.click(edit));
  const input = screen.getByLabelText("默认文章子目录") as HTMLInputElement;
  expect(input.value).toBe("笔记");
  h.pick.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("已取消目录选择，原预设未改变。");
  expect(input.value).toBe("笔记");
  h.pick.mockResolvedValueOnce(directoryTree("无效"));
  h.verify.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("当前路径没有检测到 Obsidian 仓库，请重新选择");
  expect(input.value).toBe("笔记");
  h.pick.mockResolvedValueOnce(directoryTree("新库"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText("根目录：新库");
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("请选择目录");
  expect((screen.getByText("保存本地预设") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(h.put).not.toHaveBeenCalled();
});

it("仅Markdown保留HTML图片caption且转成完整远程URL，不追加重复图", async () => {
  render(
    <SaveButton
      getSnapshot={() => ({
        ...snapshot(),
        markdown:
          '<figure><img src="/api/files/a"><figcaption>保留说明</figcaption></figure>',
        blocks: [
          { type: "image", props: { url: "/api/files/a", name: "图).png" } },
        ],
      })}
    />,
  );
  fireEvent.click(screen.getByText("保存到 Obsidian"));
  await screen.findByText("本地库");
  fireEvent.click(screen.getByRole("checkbox", { name: "仅下载 Markdown" }));
  fireEvent.click(screen.getByText("保存"));
  await screen.findByRole("status");
  const markdown = h.save.mock.lastCall?.[1].markdown as string;
  expect(markdown).toContain(
    'src="' + new URL("/api/files/a", window.location.origin).href + '"',
  );
  expect(markdown).toContain("<figcaption>保留说明</figcaption>");
  expect(markdown.match(/<img/g)).toHaveLength(1);
  expect(markdown).not.toContain("![");
  expect(h.save.mock.lastCall?.[2].markdownOnly).toBe(true);
});

it("真实根和子目录井号拒绝就近反馈，不保存或改动旧子目录", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/obsidian-local/presets")
  >("../../src/modules/obsidian-local/presets");
  h.verify.mockImplementation(actual.verifyVault);
  render(<ObsidianSettings />);
  const edit = await screen.findByText("编辑 本地库");
  await act(async () => fireEvent.click(edit));
  h.pick.mockResolvedValueOnce(directoryTree("坏#库"));
  fireEvent.click(screen.getByText("浏览选择 vault 根目录"));
  await screen.findByText(
    "目录名含 #，Obsidian 无法正确打开，请选择其他目录。",
  );
  expect(screen.getByText("根目录：vault")).toBeTruthy();
  expect(
    (screen.getByLabelText("默认文章子目录") as HTMLInputElement).value,
  ).toBe("笔记");
  expect(h.put).not.toHaveBeenCalled();
});
