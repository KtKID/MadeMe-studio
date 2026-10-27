import { describe, expect, it } from "vitest";
import { describeEditorError } from "../../src/components/editor/errors";
import { ApiError } from "../../src/components/shared/ui";

describe("describeEditorError：编辑器失败提示一律中文并带操作名", () => {
  it("服务端中文原因原样使用", () => {
    expect(
      describeEditorError(
        "publish",
        new ApiError(
          422,
          "UNSAFE_URL",
          "第 2 个视频块的地址不是视频文件或支持的平台链接",
        ),
      ),
    ).toBe("发布失败：第 2 个视频块的地址不是视频文件或支持的平台链接");
  });
  it("英文错误码翻译，VALIDATION_ERROR 指出第几个块", () => {
    expect(
      describeEditorError(
        "save",
        new ApiError(422, "VALIDATION_ERROR", "Invalid request.", [
          { path: ["blocks", 3, "props", "url"] },
        ]),
      ),
    ).toBe(
      "保存失败：提交的内容格式有误（第 4 个块的 props.url），请检查后重试。",
    );
    expect(
      describeEditorError(
        "restore",
        new ApiError(409, "VERSION_CONFLICT", "Conflict"),
      ),
    ).toContain("恢复版本失败：另一个窗口已保存了更新");
  });
  it("未知错误码保留原文与错误码；网络错误说明内容仍在", () => {
    expect(
      describeEditorError(
        "ai",
        new ApiError(500, "AI_UPSTREAM", "Upstream failed"),
      ),
    ).toBe("AI 生成失败：Upstream failed（AI_UPSTREAM）");
    expect(
      describeEditorError("save", new TypeError("Failed to fetch")),
    ).toContain("本页内容仍在");
  });
});
