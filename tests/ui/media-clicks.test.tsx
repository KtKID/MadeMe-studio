// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Media } from "../../src/shared/contracts";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  api: h.api,
}));
vi.mock(
  "../../src/modules/navigation-performance/use-navigation-ready",
  () => ({ useNavigationReady: vi.fn() }),
);
vi.mock("../../src/modules/studio-navigation/pane", () => ({
  useStudioPane: () => ({ active: true }),
}));
import MediaLibrary from "../../src/components/media/MediaLibrary";
const media = (id: string, mime = "image/png"): Media => ({
  id,
  name: `${id}.png`,
  mime,
  size: 10,
  url: `/api/files/${id}`,
  source: "upload",
  postId: null,
  prompt: "",
  createdAt: "2026-10-27T00:00:00Z",
});
beforeEach(() => {
  h.api.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("媒体库 DOM 点击（隔离 API mock）", () => {
  it("搜索/类型筛选与插入封面走正确对象，下载是原文件链接", () => {
    const insert = vi.fn(),
      cover = vi.fn();
    render(
      <MediaLibrary
        initialMedia={[media("图片甲"), media("文件乙", "application/pdf")]}
        onInsert={insert}
        onCover={cover}
      />,
    );
    fireEvent.change(screen.getByLabelText("媒体类型"), {
      target: { value: "image" },
    });
    expect(screen.queryByText("文件乙.png")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "插入" }));
    expect(insert).toHaveBeenCalledWith(media("图片甲"));
    fireEvent.click(screen.getByRole("button", { name: "设为封面" }));
    expect(cover).toHaveBeenCalledWith(media("图片甲"));
    expect(screen.getByTitle("下载").getAttribute("download")).toBe(
      "图片甲.png",
    );
    fireEvent.change(screen.getByPlaceholderText("搜索文件名或生成提示词…"), {
      target: { value: "不存在" },
    });
    expect(screen.queryByTitle("下载")).toBeNull();
    expect(h.api).not.toHaveBeenCalled();
  });
  it("未配置生成可打开说明，禁止请求，取消关闭", () => {
    render(<MediaLibrary initialMedia={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/例如/), {
      target: { value: "测试图片" },
    });
    const generate = within(dialog).getByRole("button", {
      name: "生成并保存",
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    fireEvent.click(generate);
    expect(h.api).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("文件选择取消不上传；重复 change 同步只启动一次；失败后可重试", async () => {
    let reject!: (error: Error) => void;
    h.api.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const { container } = render(<MediaLibrary initialMedia={[]} />);
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [] } });
    expect(h.api).not.toHaveBeenCalled();
    const file = new File(["fixture"], "fixture.txt", { type: "text/plain" });
    act(() => {
      fireEvent.change(input, { target: { files: [file] } });
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("上传失败")));
    expect(screen.getByRole("alert").textContent).toContain("上传失败");
    h.api.mockResolvedValueOnce({ media: media("重试") });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("重试.png")).toBeTruthy());
    expect(h.api).toHaveBeenCalledTimes(2);
  });
  it("裁剪未解码不能保存，取消不产生上传", () => {
    render(<MediaLibrary initialMedia={[media("图片甲")]} />);
    fireEvent.click(screen.getByTitle("裁剪"));
    const dialog = screen.getByRole("dialog");
    expect(
      (
        within(dialog).getByRole("button", {
          name: "保存为新图片",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.api).not.toHaveBeenCalled();
  });
});

describe("媒体列表异步边界", () => {
  it("初始 GET 迟到不能覆盖等待期间已上传的素材", async () => {
    let resolveList!: (value: { media: Media[] }) => void;
    h.api.mockImplementation((_url: string, options?: { method?: string }) => {
      if (options?.method === "POST")
        return Promise.resolve({ media: media("新上传") });
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    });
    const { container } = render(<MediaLibrary />);
    const input = container.querySelector('input[type="file"]')!;
    const file = new File(["fixture"], "fixture.txt", { type: "text/plain" });
    await act(async () =>
      fireEvent.change(input, { target: { files: [file] } }),
    );
    await act(async () => resolveList({ media: [media("旧素材")] }));
    expect(screen.getByText("新上传.png")).toBeTruthy();
    expect(screen.getByText("旧素材.png")).toBeTruthy();
  });
  it("生成失败保留提示词，重试成功插入列表并关闭对话框", async () => {
    h.api
      .mockRejectedValueOnce(new Error("模型繁忙"))
      .mockResolvedValueOnce({ media: media("生成结果") });
    render(<MediaLibrary initialMedia={[]} imageConfigured />);
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
    fireEvent.change(screen.getByPlaceholderText(/例如/), {
      target: { value: "测试提示词" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成并保存" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("模型繁忙"),
    );
    expect(
      (screen.getByPlaceholderText(/例如/) as HTMLTextAreaElement).value,
    ).toBe("测试提示词");
    fireEvent.click(screen.getByRole("button", { name: "生成并保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("生成结果.png")).toBeTruthy();
    expect(h.api).toHaveBeenCalledTimes(2);
  });
});

it("裁剪保存连续点击只上传一次，失败后原图保留且可重试", async () => {
  class DecodedImage {
    naturalWidth = 1600;
    naturalHeight = 900;
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", DecodedImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["crop"], { type: "image/jpeg" })),
  );
  let reject!: (reason: Error) => void;
  h.api.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  render(<MediaLibrary initialMedia={[media("原图")]} />);
  fireEvent.click(screen.getByTitle("裁剪"));
  const save = screen.getByRole("button", {
    name: "保存为新图片",
  }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  act(() => {
    fireEvent.click(save);
    fireEvent.click(save);
  });
  await waitFor(() => expect(h.api).toHaveBeenCalledTimes(1));
  await act(async () => reject(new Error("裁剪上传失败")));
  expect(screen.getByRole("alert").textContent).toContain("裁剪上传失败");
  expect(screen.getByText("原图.png")).toBeTruthy();
  h.api.mockResolvedValueOnce({ media: media("裁剪新图") });
  fireEvent.click(screen.getByRole("button", { name: "保存为新图片" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("原图.png")).toBeTruthy();
  expect(screen.getByText("裁剪新图.png")).toBeTruthy();
});
