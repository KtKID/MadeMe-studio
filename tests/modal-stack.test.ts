import { describe, it, expect } from "vitest";
import { ModalStack } from "../src/components/shared/modal-stack";
describe("嵌套对话框关闭边界", () => {
  it("裁剪打开后只有最上层处理Escape，素材库保持打开", () => {
    const stack = new ModalStack();
    const library = Symbol("library"),
      crop = Symbol("crop");
    stack.push(library);
    stack.push(crop);
    expect(stack.isTop(library)).toBe(false);
    expect(stack.isTop(crop)).toBe(true);
    stack.remove(crop);
    expect(stack.isTop(library)).toBe(true);
  });
  it("异常卸载下层不会移除仍活动的上层", () => {
    const stack = new ModalStack();
    const a = Symbol(),
      b = Symbol();
    stack.push(a);
    stack.push(b);
    stack.remove(a);
    expect(stack.isTop(b)).toBe(true);
    stack.remove(a);
    expect(stack.isTop(b)).toBe(true);
  });
});
