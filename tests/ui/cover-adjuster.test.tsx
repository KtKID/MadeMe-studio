// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import CoverAdjuster from "../../src/modules/cover/CoverAdjuster";
import {
  DEFAULT_COVER_SETTINGS,
  type CoverSettings,
} from "../../src/modules/cover/contracts";

afterEach(cleanup);
const square: CoverSettings = {
  aspect: "1:1",
  fit: "cover",
  focusX: 50,
  focusY: 50,
  zoom: 1,
};
function Harness({
  initial,
  spy,
}: {
  initial: CoverSettings;
  spy: (s: CoverSettings) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CoverAdjuster
      src="/api/files/test"
      value={value}
      onChange={(next) => {
        spy(next);
        setValue(next);
      }}
    />
  );
}
function loadImage(width = 1600, height = 900) {
  const img = screen.getByAltText("封面原图") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
  fireEvent.load(img);
  return img;
}

describe("封面调整器", () => {
  it("四种比例单选；原图比例时展示方式不可选并说明不裁切", () => {
    const spy = vi.fn();
    render(<Harness initial={DEFAULT_COVER_SETTINGS} spy={spy} />);
    const names = screen
      .getAllByRole("radio")
      .map((r) => r.getAttribute("aria-label") || r.textContent);
    expect(names.slice(0, 4)).toEqual([
      "原图比例",
      "正方形 1:1",
      "标准横版 4:3",
      "宽屏 16:9",
    ]);
    expect(
      screen.getByRole("radio", { name: "原图比例" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      (screen.getByRole("radio", { name: "铺满裁切" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/原图比例不裁切/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "宽屏 16:9" }));
    expect(spy).toHaveBeenLastCalledWith({
      ...DEFAULT_COVER_SETTINGS,
      aspect: "16:9",
    });
    expect(
      (screen.getByRole("radio", { name: "铺满裁切" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("完整显示不出现裁切控件；切到铺满裁切后出现缩放与位置", () => {
    const spy = vi.fn();
    render(
      <Harness initial={{ ...square, fit: "contain" }} spy={spy} />,
    );
    expect(screen.queryByLabelText("缩放")).toBeNull();
    expect(screen.getByText(/白色补足/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "铺满裁切" }));
    expect(spy).toHaveBeenLastCalledWith(square);
    fireEvent.change(screen.getByLabelText("缩放"), { target: { value: "2" } });
    expect(spy).toHaveBeenLastCalledWith({ ...square, zoom: 2 });
    fireEvent.change(screen.getByLabelText("水平位置"), {
      target: { value: "20" },
    });
    expect(spy).toHaveBeenLastCalledWith({ ...square, zoom: 2, focusX: 20 });
    fireEvent.change(screen.getByLabelText("垂直位置"), {
      target: { value: "90" },
    });
    expect(spy).toHaveBeenLastCalledWith({
      ...square,
      zoom: 2,
      focusX: 20,
      focusY: 90,
    });
  });
  it("原图上标出保留区域，其余部分显示为被裁掉", () => {
    render(<Harness initial={square} spy={vi.fn()} />);
    loadImage(1600, 900);
    const kept = screen.getByTestId("cover-kept-region");
    // 1600×900 裁成 1:1：保留宽 900/1600 = 56.25%，居中时左侧 21.875%。
    expect(kept.style.left).toBe("21.875%");
    expect(kept.style.width).toBe("56.25%");
    expect(kept.style.top).toBe("0%");
    expect(kept.style.height).toBe("100%");
  });
  it("拖动保留区域改变位置；方向键微调；越界被限制", () => {
    const spy = vi.fn();
    render(<Harness initial={square} spy={spy} />);
    loadImage(1600, 900);
    const area = screen.getByLabelText("拖动或用方向键调整保留区域");
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 112.5, right: 200, bottom: 112.5, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireEvent.pointerDown(area, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 110, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(area, { clientX: 110, clientY: 50, pointerId: 1 });
    // 10px / 200px = 5% 原图宽；可移动空间 43.75% → 位置 +11.4。
    expect(spy.mock.lastCall![0].focusX).toBeCloseTo(61.4, 1);
    expect(spy.mock.lastCall![0].focusY).toBe(50);
    fireEvent.keyDown(area, { key: "ArrowLeft" });
    expect(spy.mock.lastCall![0].focusX).toBeCloseTo(56.4, 1);
    fireEvent.keyDown(area, { key: "Home" });
    expect(spy.mock.lastCall![0].focusX).toBe(0);
    fireEvent.keyDown(area, { key: "ArrowLeft" });
    expect(spy.mock.lastCall![0].focusX).toBe(0);
  });
  it("实时预览使用同一套展示组件", () => {
    render(<Harness initial={{ ...square, aspect: "4:3" }} spy={vi.fn()} />);
    const preview = screen.getByLabelText("实时预览");
    const frame = preview.querySelector(".cover-frame") as HTMLElement;
    expect(frame.dataset.aspect).toBe("4:3");
    expect(frame.dataset.fit).toBe("cover");
  });
});
