// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { defaultSettings, type Post } from "../../src/shared/contracts";
// 只替换 BlockNote 引擎与网络边界；Editor、React state、按钮和 Modal 均是真实组件。
const h = vi.hoisted(() => ({
  api: vi.fn(),
  library: null as null | Record<string, (...args: unknown[]) => void>,
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
  default: (props: Record<string, (...args: unknown[]) => void>) => {
    h.library = props;
    return <div>媒体边界</div>;
  },
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
import { ApiError } from "../../src/components/shared/ui";
import Editor from "../../src/components/editor/Editor";
const post: Post = {
  id: "fixture",
  version: 1,
  title: "原始标题",
  slug: "fixture",
  excerpt: "",
  blocks: [{ type: "paragraph", content: "原始正文" }],
  category: "",
  tags: [],
  coverImage: "/api/files/cover",
  visibility: "draft",
  pinned: false,
  publishedAt: null,
  updatedAt: "2026-10-27T00:00:00Z",
  deletedAt: null,
};
function setup(p: Post = post) {
  render(
    <Editor
      post={p}
      settings={defaultSettings}
      authenticated
      aiConfigured={false}
      inline
      onClose={vi.fn()}
    />,
  );
}
beforeEach(() => {
  h.api.mockReset();
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

const stale = () => new ApiError(409, "VERSION_CONFLICT", "版本冲突");
const patchCalls = () =>
  h.api.mock.calls.filter((c) => c[1]?.method === "PATCH");
const bodyOf = (call: any[]) => JSON.parse(call[1].body);
const inputTitle = () => screen.getByLabelText("文章标题") as HTMLInputElement;
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
function localBody(text: string) {
  act(() => {
    h.editor.document = [{ type: "paragraph", content: text }];
    fireEvent.change(screen.getByLabelText("测试正文引擎"), {
      target: { value: text },
    });
  });
}
async function showConflict(
  remote: Post = {
    ...post,
    version: 2,
    blocks: [{ type: "paragraph", content: "服务器正文" }],
  },
) {
  localBody("本地正文");
  h.api.mockRejectedValueOnce(stale()).mockResolvedValueOnce({ post: remote });
  save();
  await screen.findByRole("dialog", { name: "处理版本冲突" });
  return remote;
}
beforeEach(() => {
  localStorage.clear();
  h.editor.document = structuredClone(post.blocks) as typeof h.editor.document;
  h.editor.replaceBlocks.mockReset().mockImplementation((_old, blocks) => {
    h.editor.document = blocks;
  });
});
afterEach(() => vi.restoreAllMocks());
describe("A/B 冲突二选一", () => {
  it("独立字段自动合并，PATCH使用实际最新版本与远端正文", async () => {
    setup();
    fireEvent.change(inputTitle(), { target: { value: "本地标题" } });
    const remote = {
      ...post,
      version: 2,
      blocks: [{ type: "paragraph", content: "服务器正文" }],
    };
    h.api
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce({ post: remote })
      .mockImplementationOnce(async (_url, opts) => ({
        post: { ...remote, ...JSON.parse(opts.body), version: 3 },
      }));
    save();
    await waitFor(() => expect(inputTitle().value).toBe("本地标题"));
    await act(async () => {});
    expect(patchCalls()).toHaveLength(2);
    expect(bodyOf(patchCalls()[1])).toMatchObject({
      version: 2,
      title: "本地标题",
      blocks: remote.blocks,
    });
    expect(h.editor.document).toEqual(remote.blocks);
  });
  it("同字段不同值必须二选一，取消再打开保留本地输入", async () => {
    setup();
    fireEvent.change(inputTitle(), { target: { value: "本地标题" } });
    const remote = { ...post, version: 2, title: "服务器标题" };
    h.api
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce({ post: remote });
    save();
    let dialog = await screen.findByRole("dialog", { name: "处理版本冲突" });
    expect(dialog.textContent).toContain("标题");
    expect(patchCalls()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(inputTitle().value).toBe("本地标题");
    h.api.mockResolvedValueOnce({ post: remote });
    fireEvent.click(screen.getByRole("button", { name: "检查版本冲突" }));
    dialog = await screen.findByRole("dialog", { name: "处理版本冲突" });
    expect(inputTitle().value).toBe("本地标题");
  });
  it("使用我的版本仅解决冲突字段，保留服务器独立标题，正文不拼接", async () => {
    setup();
    const remote = await showConflict({
      ...post,
      version: 2,
      title: "服务器标题",
      blocks: [{ type: "paragraph", content: "服务器正文" }],
    });
    h.api.mockImplementationOnce(async (_u, o) => ({
      post: { ...remote, ...JSON.parse(o.body), version: 3 },
    }));
    fireEvent.click(screen.getByRole("button", { name: "使用我的版本" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bodyOf(patchCalls()[1])).toMatchObject({
      version: 2,
      title: "服务器标题",
      blocks: [{ type: "paragraph", content: "本地正文" }],
    });
  });
  it("展示A/B内容，选B后不留副本、不修改既存浏览器数据，也不调用文章删除", async () => {
    localStorage.setItem(
      "mademe:editor-recovery:fixture:legacy",
      "保留既存数据",
    );
    const write = vi.spyOn(Storage.prototype, "setItem"),
      remove = vi.spyOn(Storage.prototype, "removeItem"),
      clear = vi.spyOn(Storage.prototype, "clear");
    setup();
    const remote = await showConflict();
    expect(
      screen.getByRole("region", { name: "A · 本地" }).textContent,
    ).toContain("本地正文");
    expect(
      screen.getByRole("region", { name: "B · 服务器" }).textContent,
    ).toContain("服务器正文");
    h.api.mockResolvedValueOnce({ post: remote });
    fireEvent.click(screen.getByRole("button", { name: "使用服务器版本" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.editor.document).toEqual(remote.blocks);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(localStorage.getItem("mademe:editor-recovery:fixture:legacy")).toBe(
      "保留既存数据",
    );
    expect(screen.queryByRole("button", { name: "本地副本" })).toBeNull();
    expect(h.api.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
  });
  it("弹窗打开后新产生的字段冲突须重新展示，不能无声采用本地", async () => {
    setup();
    await showConflict({
      ...post,
      version: 2,
      title: "服务器新标题",
      blocks: [{ type: "paragraph", content: "服务器正文" }],
    });
    fireEvent.change(inputTitle(), { target: { value: "等待中的本地标题" } });
    fireEvent.click(screen.getByRole("button", { name: "使用我的版本" }));
    await act(async () => {});
    expect(patchCalls()).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "处理版本冲突" }).textContent,
    ).toContain("标题");
  });
  it("选B确认时服务器再次更新，刷新两种状态并重新选择，不丢输入", async () => {
    setup();
    await showConflict();
    h.api.mockResolvedValueOnce({
      post: {
        ...post,
        version: 3,
        blocks: [{ type: "paragraph", content: "又更新的服务器正文" }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "使用服务器版本" }));
    await act(async () => {});
    expect(h.editor.document[0].content).toBe("本地正文");
    expect(
      screen.getByRole("region", { name: "B · 服务器" }).textContent,
    ).toContain("又更新的服务器正文");
    expect(screen.getByRole("dialog", { name: "处理版本冲突" })).toBeTruthy();
    expect(patchCalls()).toHaveLength(1);
  });
  it.each(["使用我的版本", "使用服务器版本"])(
    "%s网络失败保持输入与弹窗，不显示保存成功",
    async (label) => {
      setup();
      await showConflict();
      h.api.mockRejectedValueOnce(new TypeError("network failed"));
      fireEvent.click(screen.getByRole("button", { name: label }));
      await act(async () => {});
      expect(h.editor.document[0].content).toBe("本地正文");
      expect(screen.getByRole("dialog", { name: "处理版本冲突" })).toBeTruthy();
      expect(screen.queryByText(/已采用|已加载服务器版本/)).toBeNull();
    },
  );
  it.each(["使用我的版本", "使用服务器版本"])(
    "%s重复点击只发一个请求，期间新输入保留",
    async (label) => {
      setup();
      const remote = await showConflict();
      let resolve!: (v: any) => void;
      h.api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const before = h.api.mock.calls.length;
      const button = screen.getByRole("button", { name: label });
      act(() => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(h.api.mock.calls.length).toBe(before + 1);
      fireEvent.change(inputTitle(), {
        target: { value: "确认等待时的新输入" },
      });
      await act(async () =>
        resolve({
          post: { ...remote, version: label === "使用我的版本" ? 3 : 2 },
        }),
      );
      expect(inputTitle().value).toBe("确认等待时的新输入");
      expect(h.editor.document[0].content).toBe("本地正文");
      expect(screen.queryByText(/已采用|已加载服务器版本/)).toBeNull();
    },
  );
  it("用户确认后服务器再次改变，仍409并重新选择，不自动覆盖", async () => {
    setup();
    await showConflict();
    const newer = {
      ...post,
      version: 3,
      title: "再次更新",
      blocks: [{ type: "paragraph", content: "又更新正文" }],
    };
    h.api.mockRejectedValueOnce(stale()).mockResolvedValueOnce({ post: newer });
    fireEvent.click(screen.getByRole("button", { name: "使用我的版本" }));
    await act(async () => {});
    expect(bodyOf(patchCalls()[1]).version).toBe(2);
    expect(patchCalls()).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "处理版本冲突" })).toBeTruthy();
    expect(h.editor.document[0].content).toBe("本地正文");
  });
  it("载入服务器期间又输入，保留输入且不误报成功", async () => {
    setup();
    const remote = await showConflict();
    let resolve!: (v: any) => void;
    h.api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(screen.getByRole("button", { name: "使用服务器版本" }));
    fireEvent.change(inputTitle(), { target: { value: "等待中新输入" } });
    await act(async () => resolve({ post: remote }));
    expect(inputTitle().value).toBe("等待中新输入");
    expect(h.editor.document[0].content).toBe("本地正文");
  });
  it("合并提交期间继续编辑，不给新输入套上已合并版本", async () => {
    setup();
    fireEvent.change(inputTitle(), { target: { value: "提交标题" } });
    let resolve!: (v: any) => void;
    const remote = {
      ...post,
      version: 2,
      blocks: [{ type: "paragraph", content: "服务器正文" }],
    };
    h.api
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce({ post: remote })
      .mockReturnValueOnce(new Promise((r) => (resolve = r)));
    save();
    await waitFor(() => expect(patchCalls()).toHaveLength(2));
    fireEvent.change(inputTitle(), { target: { value: "合并等待中新输入" } });
    await act(async () =>
      resolve({ post: { ...remote, title: "提交标题", version: 3 } }),
    );
    expect(inputTitle().value).toBe("合并等待中新输入");
    expect(h.editor.document).toEqual(post.blocks);
    h.api.mockRejectedValueOnce(stale()).mockResolvedValueOnce({
      post: { ...remote, title: "服务器第三版", version: 3 },
    });
    save();
    await act(async () => {});
    expect(bodyOf(patchCalls()[2]).version).toBe(1);
  });
  it.each([undefined, 2])(
    "删除回调previousVersion=%s不匹配时不能把v1跳到v3",
    async (previousVersion) => {
      setup();
      fireEvent.click(screen.getByRole("button", { name: /^发布/ }));
      fireEvent.click(screen.getByRole("button", { name: "更换图片" }));
      act(() =>
        h.library!.onDeleted(
          { id: "cover", url: post.coverImage },
          {
            deleted: true,
            clearedCovers: [
              {
                postId: post.id,
                version: 3,
                ...(previousVersion ? { previousVersion } : {}),
              },
            ],
          },
        ),
      );
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });
      h.api.mockResolvedValueOnce({ post: { ...post, version: 2 } });
      save();
      await act(async () => {});
      expect(bodyOf(patchCalls()[0]).version).toBe(1);
    },
  );
  it("删除异步回调不能清空之后新选的封面", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^发布/ }));
    fireEvent.click(screen.getByRole("button", { name: "更换图片" }));
    const old = h.library!.onDeleted;
    act(() => h.library!.onCover({ url: "/api/files/new" }));
    act(() =>
      old(
        { id: "cover", url: post.coverImage },
        {
          deleted: true,
          clearedCovers: [{ postId: post.id, previousVersion: 1, version: 2 }],
        },
      ),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    h.api.mockResolvedValueOnce({
      post: { ...post, coverImage: "/api/files/new", version: 3 },
    });
    save();
    await act(async () => {});
    expect(bodyOf(patchCalls()[0])).toMatchObject({
      version: 2,
      coverImage: "/api/files/new",
    });
  });
});
