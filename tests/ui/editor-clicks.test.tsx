// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { defaultSettings, type Post } from "../../src/shared/contracts";
// 只替换 BlockNote 引擎与网络边界；Editor、React state、按钮和 Modal 均是真实组件。
const h = vi.hoisted(() => ({
  api: vi.fn(),
  replaceBlocks: vi.fn(),
  editor: {
    document: [{ type: "paragraph", content: "原始正文" }],
    replaceBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(() => "原始正文"),
    tryParseMarkdownToBlocks: vi.fn(() => [
      { type: "paragraph", content: "导入正文" },
    ]),
    getSelectedText: vi.fn(() => "选区"),
    focus: vi.fn(),
    insertInlineContent: vi.fn(),
    insertBlocks: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({ block: {} })),
  },
}));
vi.mock("@blocknote/core", () => ({
  BlockNoteSchema: { create: () => ({}) },
  defaultBlockSpecs: {},
}));
vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: () => h.editor,
  createReactBlockSpec: () => () => ({}),
  FormattingToolbar: () => null,
  FormattingToolbarController: () => null,
}));
vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: ({
    onChange,
    editable,
  }: {
    onChange: () => void;
    editable: boolean;
  }) => (
    <textarea
      aria-label="测试正文引擎"
      disabled={!editable}
      onChange={onChange}
    />
  ),
}));
vi.mock("@blocknote/mantine/style.css", () => ({}));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  api: h.api,
}));
vi.mock("../../src/components/media/MediaLibrary", () => ({
  default: () => <div>媒体边界</div>,
}));
// 类型服务边界独立测试；旧编辑器保存竞态用例不消费类型 GET 请求队列。
vi.mock("../../src/modules/article-types/client", async (original) => ({
  ...(await original<object>()),
  useArticleTypes: (types: unknown[]) => ({
    types,
    loading: false,
    error: "",
    refresh: vi.fn(),
  }),
}));
import Editor from "../../src/components/editor/Editor";
import { ApiError } from "../../src/components/shared/ui";
const post: Post = {
  id: "fixture",
  version: 1,
  title: "原始标题",
  slug: "fixture",
  excerpt: "",
  blocks: [{ type: "paragraph", content: "原始正文" }],
  category: "",
  tags: [],
  coverImage: "",
  visibility: "draft",
  pinned: false,
  publishedAt: null,
  updatedAt: "2026-10-27T00:00:00Z",
  deletedAt: null,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(onClose = vi.fn()) {
  render(
    <Editor
      post={post}
      settings={defaultSettings}
      authenticated
      aiConfigured={false}
      inline
      onClose={onClose}
    />,
  );
  return onClose;
}
beforeEach(() => {
  h.api.mockReset();
  h.editor.replaceBlocks.mockReset();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("编辑器真实按钮与状态链路", () => {
  it("原地返回只显示站内 Modal，取消保留输入，确认才关闭", () => {
    const close = setup();
    fireEvent.change(screen.getByLabelText("文章标题"), {
      target: { value: "没有保存的新标题" },
    });
    fireEvent.click(screen.getByTitle("返回阅读"));
    expect(screen.getByRole("dialog").textContent).toContain(
      "还有未保存的修改",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect((screen.getByLabelText("文章标题") as HTMLInputElement).value).toBe(
      "没有保存的新标题",
    );
    fireEvent.click(screen.getByTitle("返回阅读"));
    fireEvent.click(screen.getByRole("button", { name: "丢弃修改并返回" }));
    expect(close).toHaveBeenCalledOnce();
    expect(h.api).not.toHaveBeenCalled();
  });
  it("保存请求迟到不会覆盖等待期间的新标题，重复点击只有一笔写入", async () => {
    const pending = deferred<{ post: Post }>();
    h.api.mockReturnValueOnce(pending.promise);
    setup();
    fireEvent.change(screen.getByLabelText("文章标题"), {
      target: { value: "发送快照" },
    });
    const save = screen.getByRole("button", { name: "保存草稿" });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    fireEvent.change(screen.getByLabelText("文章标题"), {
      target: { value: "等待时的新标题" },
    });
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve({ post: { ...post, title: "发送快照", version: 2 } }),
    );
    expect((screen.getByLabelText("文章标题") as HTMLInputElement).value).toBe(
      "等待时的新标题",
    );
    expect(screen.getByText(/你刚输入的内容仍未保存/)).toBeTruthy();
  });
  it("恢复历史请求迟到保留等待期间的新输入，不替换正文", async () => {
    const pending = deferred<{ post: Post }>();
    h.api
      .mockResolvedValueOnce({
        revisions: [
          {
            version: 1,
            title: "旧标题",
            createdAt: post.updatedAt,
            reason: "save",
          },
        ],
      })
      .mockReturnValueOnce(pending.promise);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复草稿" }));
    fireEvent.change(screen.getByLabelText("文章标题"), {
      target: { value: "恢复等待中输入" },
    });
    await act(async () =>
      pending.resolve({ post: { ...post, version: 3, title: "服务器旧快照" } }),
    );
    expect((screen.getByLabelText("文章标题") as HTMLInputElement).value).toBe(
      "恢复等待中输入",
    );
    expect(h.editor.replaceBlocks).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("新输入已保留");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    h.api.mockResolvedValueOnce({
      post: { ...post, title: "恢复等待中输入", version: 4 },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    const saveRequest = h.api.mock.calls.at(-1)!;
    expect(saveRequest[0]).toBe("/api/posts/fixture");
    expect(JSON.parse(saveRequest[1].body)).toMatchObject({
      version: 3,
      title: "恢复等待中输入",
    });
    await act(async () => {});
  });
  it("409 后载入最新版本的迟到响应不覆盖继续输入", async () => {
    const pending = deferred<{ post: Post }>();
    h.api
      .mockRejectedValueOnce(new ApiError(409, "CONFLICT", "版本冲突"))
      .mockReturnValueOnce(pending.promise);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "载入最新版本" }),
    );
    fireEvent.change(screen.getByLabelText("文章标题"), {
      target: { value: "载入等待时的新输入" },
    });
    await act(async () =>
      pending.resolve({ post: { ...post, version: 2, title: "服务器新标题" } }),
    );
    expect((screen.getByLabelText("文章标题") as HTMLInputElement).value).toBe(
      "载入等待时的新输入",
    );
    expect(h.editor.replaceBlocks).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("alert")
        .some((a) => a.textContent?.includes("保留本地输入")),
    ).toBe(true);
  });
  it("Markdown 文件读取迟到不覆盖随后输入", async () => {
    const pending = deferred<string>();
    setup();
    const file = new File(["# 导入标题"], "test.md", { type: "text/markdown" });
    Object.defineProperty(file, "text", { value: () => pending.promise });
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("文章标题"), {
      target: { value: "文件读取中输入" },
    });
    await act(async () => pending.resolve("# 导入标题\n正文"));
    expect(h.editor.replaceBlocks).not.toHaveBeenCalled();
    expect((screen.getByLabelText("文章标题") as HTMLInputElement).value).toBe(
      "文件读取中输入",
    );
  });
  it("发布等待保存时锁定可见范围，防止界面选择与提交快照不一致", async () => {
    const pending = deferred<{ post: Post }>();
    h.api.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      post: {
        ...post,
        version: 3,
        visibility: "unlisted",
        publishedAt: post.updatedAt,
      },
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    const visibility = screen.getByRole("combobox", {
      name: "谁可以阅读",
    }) as HTMLButtonElement;
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(visibility);
    // 未配置 SESSION_SECRET 时密码选项可见但禁用，与原生 option disabled 一致。
    expect(
      screen
        .getByRole("option", { name: "密码保护 · 输入密码后访问" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("option", { name: "不公开列出 · 仅通过链接访问" }),
    );
    expect(visibility.textContent).toBe("不公开列出 · 仅通过链接访问");
    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
    expect(visibility.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "再检查一下" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => pending.resolve({ post: { ...post, version: 2 } }));
    expect(h.api).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.api.mock.calls[1][1].body)).toMatchObject({
      version: 2,
      visibility: "unlisted",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it.each([true, false])(
  "文章 existing=%s 直接可见类型选择，选择后与标签独立保存",
  async (existing) => {
    h.api.mockImplementation(async (url, init) => {
      if (url === "/api/article-types")
        return {
          types: [
            { id: "ai", name: "AI" },
            { id: "reflection", name: "感悟" },
          ],
        };
      return { post: { ...post, ...JSON.parse(init.body), version: 2 } };
    });
    render(
      <Editor
        post={existing ? post : undefined}
        settings={defaultSettings}
        authenticated
        aiConfigured={false}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "文章类型" }));
    fireEvent.click(screen.getByRole("option", { name: "AI" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findAllByText(/草稿已保存/);
    const write = h.api.mock.calls.find(
      ([url]) => url === (existing ? "/api/posts/fixture" : "/api/posts"),
    )!;
    expect(JSON.parse(write[1].body)).toMatchObject({
      categoryId: "ai",
      category: "AI",
      tags: [],
    });
  },
);

it("AI 对话框的动作、模型、提示词使用共享下拉；未配置模型禁用，切换动作重置提示词", () => {
  const settings = {
    ...defaultSettings,
    providers: [
      {
        id: "p1",
        name: "甲",
        kind: "openai" as const,
        model: "m1",
        temperature: 0.7,
        maxTokens: 2048,
        configured: false,
        textConfigured: false,
      },
      {
        id: "p2",
        name: "乙",
        kind: "openai" as const,
        model: "m2",
        temperature: 0.7,
        maxTokens: 2048,
        configured: true,
        textConfigured: true,
      },
    ],
    prompts: [
      {
        id: "pr1",
        name: "我的扩写",
        action: "expand" as const,
        template: "{{selection}}",
      },
    ],
  };
  render(
    <Editor
      post={post}
      settings={settings}
      authenticated
      aiConfigured
      inline
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /AI 助手/ }));
  const dialog = screen.getByRole("dialog");
  expect(dialog.querySelector("select")).toBeNull();
  const model = screen.getByRole("combobox", { name: "模型" });
  fireEvent.click(model);
  expect(
    screen
      .getByRole("option", { name: "甲 · m1（文本未配置）" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("option", { name: "乙 · m2（配置已就绪，未验证联调）" }),
  );
  expect(model.textContent).toBe("乙 · m2（配置已就绪，未验证联调）");
  const action = screen.getByRole("combobox", { name: "想怎么处理" });
  fireEvent.click(action);
  expect(screen.getByRole("option", { selected: true }).textContent).toBe(
    "润色文字",
  );
  fireEvent.click(screen.getByRole("option", { name: "展开写写" }));
  const prompt = screen.getByRole("combobox", { name: "提示词" });
  fireEvent.click(prompt);
  fireEvent.click(screen.getByRole("option", { name: "我的扩写" }));
  expect(prompt.textContent).toBe("我的扩写");
  fireEvent.click(action);
  fireEvent.click(screen.getByRole("option", { name: "换一种说法" }));
  expect(prompt.textContent).toBe("内置提示词");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
