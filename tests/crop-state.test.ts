import { describe, it, expect } from "vitest";
import {
  CropRenderGuard,
  cropGeometry,
} from "../src/components/media/crop-state";
describe("图片裁剪输出前置条件", () => {
  it("加载前和404失败不能导出默认空白canvas", () => {
    const guard = new CropRenderGuard();
    expect(() => guard.assertReady("a")).toThrow();
    guard.begin("a");
    expect(() => guard.assertReady("a")).toThrow();
    guard.failed("a");
    expect(guard.canExport("a")).toBe(false);
  });
  it("只有成功解码并绘制当前版本才可导出", () => {
    const guard = new CropRenderGuard();
    guard.begin("a");
    expect(guard.drawn("a", 0, 200)).toBe(false);
    expect(() => guard.assertReady("a")).toThrow();
    expect(guard.drawn("a", 640, 480)).toBe(true);
    expect(() => guard.assertReady("a")).not.toThrow();
  });
  it("比例或位置改变即使新effect还未执行也不可导出旧画面", () => {
    const guard = new CropRenderGuard();
    guard.begin("a");
    guard.drawn("a", 640, 480);
    expect(guard.canExport("b")).toBe(false);
    guard.begin("b");
    expect(guard.drawn("a", 640, 480)).toBe(false);
    expect(guard.canExport("b")).toBe(false);
  });
  it("过期图片加载不能覆盖新的裁剪结果", () => {
    const guard = new CropRenderGuard();
    guard.begin("a");
    guard.begin("b");
    guard.drawn("b", 640, 480);
    guard.failed("a");
    expect(guard.canExport("b")).toBe(true);
  });
  it("16:9与方形裁剪尺寸正确且源区域不越界", () => {
    for (const ratio of [16 / 9, 1, 0.75]) {
      const geometry = cropGeometry(640, 480, ratio, 2, 100, 0);
      expect(geometry.sx + geometry.sw).toBeLessThanOrEqual(640);
      expect(geometry.sy + geometry.sh).toBeLessThanOrEqual(480);
      expect(geometry.width).toBe(1200);
      expect(geometry.height).toBe(Math.round(1200 / ratio));
    }
    expect(cropGeometry(640, 480, 16 / 9, 1, 50, 50).height).toBe(675);
  });
});
