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
    document: [] as unknown[],
    updateBlock: vi.fn(),
    removeBlocks: vi.fn(),
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
import { readFileSync } from "node:fs";
import Editor from "../../src/components/editor/Editor";
// 作者粘进视频块的 X 官方嵌入代码（tests/fixtures/x-embed-snippet.html）。
const snippet = readFileSync("tests/fixtures/x-embed-snippet.html", "utf8");
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
  h.editor.updateBlock.mockReset();
  h.editor.removeBlocks.mockReset();
  h.editor.document = [
    { id: "p1", type: "paragraph", content: [] },
    { id: "v1", type: "video", props: { url: snippet } },
  ];
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

function openPublish() {
  fireEvent.click(screen.getByRole("button", { name: /^发布/ }));
  fireEvent.click(screen.getByRole("button", { name: /确认发布/ }));
}
function dialogText() {
  return screen.getByRole("dialog").textContent ?? "";
}

describe("保存 / 发布失败必须在操作附近显示中文原因", () => {
  it("视频块里是 X 嵌入代码：不发请求，发布弹窗里显示块位置并可一键改为嵌入块", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setup();
    openPublish();
    await act(async () => {});
    expect(h.api).not.toHaveBeenCalled();
    const alert = screen
      .getAllByRole("alert")
      .find((el) => screen.getByRole("dialog").contains(el));
    expect(alert?.textContent).toContain("发布失败：第 1 个视频块");
    expect(alert?.textContent).toContain("X 的嵌入代码");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("editor.save_blocked");
    expect(logged).toContain('"blockType":"video"');
    expect(logged).not.toContain("op7418"); // 日志不含链接
    expect(dialogText()).toContain("X 动态的嵌入代码，不是视频");
    const convert = screen.getAllByRole("button", { name: "改为嵌入块" });
    fireEvent.click(convert[convert.length - 1]);
    expect(h.editor.replaceBlocks).toHaveBeenCalledWith(
      ["v1"],
      [
        {
          type: "embed",
          props: { url: "https://x.com/op7418/status/2115000078104691168" },
        },
      ],
    );
    warn.mockRestore();
  });
  it("YouTube / Bilibili 嵌入代码粘进视频块：自动换成规范链接", () => {
    h.editor.document = [
      {
        id: "v2",
        type: "video",
        props: {
          url: '<iframe src="//player.bilibili.com/player.html?isOutside=true&amp;aid=1&amp;bvid=BV1KW4y1j7AF&amp;cid=2&amp;p=1" allowfullscreen="true"></iframe>',
        },
      },
    ];
    vi.spyOn(console, "info").mockImplementation(() => {});
    setup();
    expect(h.editor.updateBlock).toHaveBeenCalledWith("v2", {
      props: { url: "https://www.bilibili.com/video/BV1KW4y1j7AF/" },
    });
  });
  it("服务端 422 的中文原因显示在发布弹窗里", async () => {
    h.editor.document = [];
    h.api.mockRejectedValueOnce(
      new ApiError(422, "UNSAFE_URL", "第 3 个图片块的地址无效：请上传文件。", {
        problems: [{ blockId: "x", blockType: "image", ordinal: 3 }],
      }),
    );
    setup();
    openPublish();
    await act(async () => {});
    expect(dialogText()).toContain("发布失败：第 3 个图片块的地址无效");
  });
  it("英文错误码翻译为中文；网络中断说明内容仍在", async () => {
    h.editor.document = [];
    h.api.mockRejectedValueOnce(
      new ApiError(409, "SLUG_CONFLICT", "Slug is already used."),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setup();
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain(
      "保存失败：链接标识已被其他文章使用",
    );
    h.api.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain(
      "保存失败：网络连接中断",
    );
  });
});
