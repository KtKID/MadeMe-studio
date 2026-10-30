// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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
import { DEFAULT_COVER_SETTINGS } from "../../src/modules/cover/contracts";
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
const editorFrame = () =>
  document.querySelector<HTMLElement>(".editor-cover .cover-frame")!;
const lastBody = () => JSON.parse(h.api.mock.calls.at(-1)![1].body);
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

describe("编辑器封面：调整入口与持久化", () => {
  it("旧文章无设置时按默认原图比例完整显示，不再固定裁切", () => {
    setup();
    expect(editorFrame().dataset.aspect).toBe("original");
    expect(editorFrame().dataset.fit).toBe("contain");
  });
  it("调整→取消不改动；调整→应用后保存草稿带上设置", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "调整封面" }));
    const dialog = () =>
      screen.getByRole("dialog", { name: "调整封面 · 保留原图" });
    fireEvent.click(
      within(dialog()).getByRole("radio", { name: "正方形 1:1" }),
    );
    fireEvent.click(within(dialog()).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editorFrame().dataset.aspect).toBe("original");
    fireEvent.click(screen.getByRole("button", { name: "调整封面" }));
    fireEvent.click(within(dialog()).getByRole("radio", { name: "宽屏 16:9" }));
    fireEvent.click(within(dialog()).getByRole("radio", { name: "铺满裁切" }));
    fireEvent.change(within(dialog()).getByLabelText("垂直位置"), {
      target: { value: "0" },
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "应用" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editorFrame().dataset.aspect).toBe("16:9");
    expect(editorFrame().dataset.fit).toBe("cover");
    h.api.mockResolvedValueOnce({ post: { ...post, version: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await act(async () => {});
    expect(lastBody()).toMatchObject({
      coverImage: "/api/files/cover",
      coverSettings: {
        aspect: "16:9",
        fit: "cover",
        focusX: 50,
        focusY: 0,
        zoom: 1,
      },
    });
  });
  it("载入已有设置；移除封面同时清回默认设置", async () => {
    setup({
      ...post,
      coverSettings: {
        aspect: "4:3",
        fit: "cover",
        focusX: 0,
        focusY: 0,
        zoom: 2,
      },
    });
    expect(editorFrame().dataset.aspect).toBe("4:3");
    fireEvent.click(screen.getByRole("button", { name: "移除封面" }));
    expect(screen.getByRole("button", { name: "添加封面" })).toBeTruthy();
    h.api.mockResolvedValueOnce({ post: { ...post, version: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await act(async () => {});
    expect(lastBody()).toMatchObject({
      coverImage: "",
      coverSettings: DEFAULT_COVER_SETTINGS,
    });
  });
  it("发布面板有封面区：选比例与展示方式并实时预览，发布前保存这些设置", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /发布/ }));
    const dialog = screen.getByRole("dialog");
    const section = within(dialog).getByRole("group", { name: "封面" });
    fireEvent.click(
      within(section).getByRole("radio", { name: "标准横版 4:3" }),
    );
    const preview = within(section).getByLabelText("实时预览");
    expect(
      preview.querySelector<HTMLElement>(".cover-frame")!.dataset.aspect,
    ).toBe("4:3");
    expect(
      within(section).getByRole("button", { name: "更换图片" }),
    ).toBeTruthy();
    h.api
      .mockResolvedValueOnce({ post: { ...post, version: 2 } })
      .mockResolvedValueOnce({
        post: {
          ...post,
          version: 3,
          visibility: "public",
          publishedAt: post.updatedAt,
        },
      });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));
    await act(async () => {});
    const saveBody = JSON.parse(h.api.mock.calls[0][1].body);
    expect(saveBody.coverSettings).toEqual({
      ...DEFAULT_COVER_SETTINGS,
      aspect: "4:3",
    });
    expect(h.api.mock.calls[1][0]).toBe("/api/posts/fixture/publish");
  });
  it("没有封面时发布面板提供选图入口", () => {
    setup({ ...post, coverImage: "" });
    fireEvent.click(screen.getByRole("button", { name: /发布/ }));
    const section = within(screen.getByRole("dialog")).getByRole("group", {
      name: "封面",
    });
    expect(
      within(section).getByRole("button", { name: "选择封面图片" }),
    ).toBeTruthy();
  });
});
