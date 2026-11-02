import { afterEach, describe, it, expect, vi } from "vitest";
import {
  uploadAttachment,
  createDraftWithAttachments,
} from "../../integrations/shared/client";
import {
  MiB,
  INTEGRATION_MEDIA_UPLOAD_TIMEOUT_MS,
} from "../../src/modules/config/limits";
import { throwIfAborted } from "../../src/shared/request-cancellation";
const token = "mm_" + "a".repeat(64);
const media = {
  id: "test-id",
  name: "large.mp4",
  url: "/api/files/test-id",
  mime: "video/mp4",
  size: 25 * MiB,
  createdAt: "2026-11-02T00:00:00.000Z",
  postId: null,
  source: "upload",
};
const original = {
  any: Object.getOwnPropertyDescriptor(AbortSignal, "any")!,
  timeout: Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!,
  throwIfAborted: Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    "throwIfAborted",
  )!,
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const name of ["any", "timeout"] as const)
    Object.defineProperty(AbortSignal, name, original[name]);
  Object.defineProperty(
    AbortSignal.prototype,
    "throwIfAborted",
    original.throwIfAborted,
  );
});
describe("媒体上传等待与旧运行时取消", () => {
  it("主动取消有独立错误且不反射调用方的取消原因", async () => {
    const controller = new AbortController();
    const result = uploadAttachment({
      site: "https://example.com",
      token,
      file: new File(["test"], "x.png", { type: "image/png" }),
      signal: controller.signal,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    });
    controller.abort(new Error(token));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await expect(result).rejects.toThrow(/已取消/);
    await expect(result).rejects.not.toThrow(token);
  });
  it("非JSON媒体响应包装成中文错误，不包含响应体片段", async () => {
    const result = uploadAttachment({
      site: "https://example.com",
      token,
      file: new File(["test"], "x.png", { type: "image/png" }),
      fetchImpl: async () => new Response(`<html>${token}</html>`),
    });
    await expect(result).rejects.toThrow(/响应格式异常/);
    await expect(result).rejects.not.toThrow(token);
  });
  it("非Error取消原因不会直接抛出字符串", () => {
    const controller = new AbortController();
    controller.abort("private reason");
    expect(() => throwIfAborted(controller.signal)).toThrow(/操作已取消/);
  });
  it("25MiB附件模拟45秒传输不会在20秒中止，结束清理计时器", async () => {
    vi.useFakeTimers();
    let completed = false,
      aborted = false;
    // 原生 AbortSignal.timeout 不受 Vitest 时钟影响，把旧实现的计时也接入受控时钟。
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const file = new File([new Uint8Array(25 * MiB)], "large.mp4", {
      type: "video/mp4",
    });
    const result = uploadAttachment({
      site: "https://example.com",
      token,
      file,
      fetchImpl: async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(Response.json({ media })),
            45000,
          );
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              clearTimeout(timer);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    }).then((value) => {
      completed = true;
      return value;
    });
    void result.catch(() => {});
    await vi.advanceTimersByTimeAsync(21000);
    expect(aborted).toBe(false);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(24000);
    expect((await result).mime).toBe("video/mp4");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("没有any/timeout/throwIfAborted仍能导入，完成后解除外部取消监听", async () => {
    for (const name of ["any", "timeout"] as const)
      Object.defineProperty(AbortSignal, name, {
        value: undefined,
        configurable: true,
      });
    Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
      value: undefined,
      configurable: true,
    });
    const controller = new AbortController(),
      remove = vi.spyOn(controller.signal, "removeEventListener");
    const file = new File(["synthetic"], "x.mp4", { type: "video/mp4" });
    const result = await createDraftWithAttachments({
      site: "https://example.com",
      token,
      title: "test",
      markdown: "![[x.mp4]]",
      assets: [{ path: "x.mp4", file }],
      resolve: { mode: "selected" },
      signal: controller.signal,
      fetchImpl: async (url) =>
        url.toString().endsWith("/api/media")
          ? Response.json({ media })
          : Response.json({ post: { id: "draft-id", version: 1 } }),
    });
    expect(result.visibility).toBe("draft");
    expect(remove).toHaveBeenCalled();
  });
  it("用户取消慢上传后不创建草稿，清理上传计时器", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let posts = 0;
    const file = new File(["synthetic"], "x.mp4", { type: "video/mp4" });
    const result = createDraftWithAttachments({
      site: "https://example.com",
      token,
      title: "test",
      markdown: "![[x.mp4]]",
      assets: [{ path: "x.mp4", file }],
      resolve: { mode: "selected" },
      signal: controller.signal,
      fetchImpl: async (url, init) => {
        if (url.toString().endsWith("/api/posts")) {
          posts++;
          return Response.json({ post: { id: "x", version: 1 } });
        }
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          ),
        );
      },
    });
    const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(21000);
    controller.abort();
    await rejected;
    expect(posts).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("媒体等待仍有独立上限，预先取消也不会发出请求", async () => {
    vi.useFakeTimers();
    const file = new File(["synthetic"], "x.mp4", { type: "video/mp4" });
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("timed out")),
            { once: true },
          ),
        ),
    );
    await expect(
      uploadAttachment({
        site: "https://example.com",
        token,
        file,
        signal: controller.signal,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const result = uploadAttachment({
      site: "https://example.com",
      token,
      file,
      fetchImpl,
    });
    const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(INTEGRATION_MEDIA_UPLOAD_TIMEOUT_MS + 1);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
