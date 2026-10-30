import { describe, expect, it, vi } from "vitest";
import {
  createBlogHarnessAdapter,
  readHarnessSuggestion,
} from "../src/modules/codex-harness/adapter";
const requestId = "10000000-0000-4000-8000-000000000001";
const options = { model: "fixture-model" };
const id = "10000000-0000-4000-8000-000000000002";
describe("博客只交换白名单业务意图，不耦合 Codex 进程或凭据", () => {
  it("润色只提交选区，不上传整篇文章/路径/会话凭据", async () => {
    const submit = vi.fn(async (input) => ({
      id,
      requestId: input.requestId,
      kind: input.kind,
      mode: input.mode,
      model: input.model,
      status: "queued",
    }));
    const adapter = createBlogHarnessAdapter({ submit });
    await adapter.polishSelection("  所选文字  ", requestId, options);
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      requestId,
      kind: "polish-selection",
      input: "所选文字",
      model: "fixture-model", mode: "replay", recordConsent: false,
    });
  });
  it("生图只提交提示词，失败不做媒体假记录", async () => {
    const submit = vi.fn(async () => {
      throw new Error("TOOL_UNAVAILABLE");
    });
    await expect(
      createBlogHarnessAdapter({ submit }).generateImage("一幅图", requestId, options),
    ).rejects.toThrow("TOOL_UNAVAILABLE");
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("回执身份不匹配时拒绝，不能将别的任务当当前建议", async () => {
    const submit = vi.fn(async () => ({
      id,
      requestId: id,
      kind: "polish-selection",
      model: "fixture-model", mode: "replay",
      status: "queued",
    }));
    await expect(
      createBlogHarnessAdapter({ submit }).polishSelection("文字", requestId, options),
    ).rejects.toThrow("任务回执不匹配");
  });
  it("只接受真正完成的文本；图片不能用助手文字冒充产物", () => {
    const task = {
      id,
      requestId,
      kind: "polish-selection",
      model: "fixture-model", mode: "replay",
      status: "running",
      result: { text: "尚未完成" },
    };
    expect(readHarnessSuggestion(task)).toBeNull();
    expect(readHarnessSuggestion({ ...task, status: "completed" })).toEqual({
      kind: "text",
      text: "尚未完成",
    });
    expect(
      readHarnessSuggestion({
        ...task,
        status: "completed",
        kind: "image-generation",
      }),
    ).toBeNull();
    expect(
      readHarnessSuggestion({
        ...task,
        status: "completed",
        kind: "image-generation",
        result: { artifactId: id },
      }),
    ).toEqual({ kind: "image", artifactId: id });
  });
  it("拒绝空选区，完全不调用 transport", async () => {
    const submit = vi.fn();
    await expect(
      createBlogHarnessAdapter({ submit }).polishSelection(" ", requestId, options),
    ).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });
});
