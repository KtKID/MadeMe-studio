import { describe, expect, it, vi } from "vitest";
import { EditClock } from "../src/components/editor/editor-state";
import { applyEditorReplacement } from "../src/components/editor/editor-replacement";

describe("异步正文替换不能覆盖较新的输入", () => {
  it("载入期间新增输入时不替换、不清除 dirty", async () => {
    const clock = new EditClock();
    clock.edit();
    const sequence = clock.snapshot();
    const replace = vi.fn();
    clock.edit();
    expect(applyEditorReplacement(clock, sequence, replace)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(clock.dirty).toBe(true);
  });
  it("没有新输入时执行替换，替换失败也不能清除原草稿状态", () => {
    const clock = new EditClock();
    clock.edit();
    const sequence = clock.snapshot();
    expect(() =>
      applyEditorReplacement(clock, sequence, () => {
        throw new Error("decode");
      }),
    ).toThrow("decode");
    expect(clock.dirty).toBe(true);
    const replace = vi.fn();
    expect(applyEditorReplacement(clock, sequence, replace)).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
  });
});
