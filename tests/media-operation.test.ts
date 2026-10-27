import { describe, expect, it } from "vitest";
import { MediaOperation } from "../src/components/media/media-operation";
describe("媒体写入单飞", () => {
  it("同一 render 内连续点击仅启动一次，成功或失败释放后允许重试", () => {
    const operation = new MediaOperation();
    expect(operation.begin()).toBe(true);
    expect(operation.begin()).toBe(false);
    operation.end();
    expect(operation.begin()).toBe(true);
    operation.end();
    expect(operation.begin()).toBe(true);
  });
});
