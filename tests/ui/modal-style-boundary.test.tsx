// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Modal } from "../../src/components/shared/ui";
const stylesheet = readFileSync("src/styles/global.css", "utf8");
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  // jsdom不具备真实指针/键盘渲染：以同specificity的class替代状态伪类，验证真实CSS cascade。
  style.textContent = stylesheet
    .replace(/:hover/g, ".test-hover")
    .replace(/:focus-visible/g, ".test-focus-visible");
  document.head.appendChild(style);
});
afterEach(() => {
  cleanup();
  style.remove();
  delete document.documentElement.dataset.mode;
});
function fixture() {
  const close = vi.fn();
  render(
    <div className="writing-shortcuts">
      <button>工具栏按钮</button>
      <Modal title="保存对话框" onClose={close}>
        <p>正文</p>
        <div className="modal-actions">
          <button className="button">取消</button>
          <button className="button primary">确认保存</button>
          <button className="button primary" disabled>
            保存中
          </button>
        </div>
      </Modal>
    </div>,
  );
  return close;
}
it("即使Modal嵌套也不被快捷栏CSS污染，按钮保留padding与字号", () => {
  fixture();
  const dialog = screen.getByRole("dialog");
  const button = screen.getByText("确认保存");
  expect(getComputedStyle(button).paddingTop).toBe("10px");
  expect(getComputedStyle(button).paddingLeft).toBe("17px");
  expect(getComputedStyle(button).fontSize).toBe("12px");
  expect(getComputedStyle(dialog).paddingTop).toBe("26px");
  expect(getComputedStyle(dialog).paddingLeft).toBe("26px");
  expect(getComputedStyle(screen.getByText("保存对话框")).fontSize).toBe(
    "19px",
  );
});
it.each(["light", "dark"])(
  "%s 模拟hover不使primary前景色等于背景；disabled与focus样式/关闭保持",
  (mode) => {
    document.documentElement.dataset.mode = mode;
    const close = fixture();
    const button = screen.getByText("确认保存");
    const normal = getComputedStyle(button).color;
    button.classList.add("test-hover");
    expect(getComputedStyle(button).color).toBe(normal);
    expect(getComputedStyle(button).color).not.toBe(
      getComputedStyle(button).backgroundColor,
    );
    button.classList.add("test-focus-visible");
    expect(getComputedStyle(button).outline).toContain("2px");
    expect((screen.getByText("保存中") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(getComputedStyle(screen.getByText("保存中")).opacity).toBe("0.48");
    expect(getComputedStyle(screen.getByText("保存中")).cursor).toBe(
      "not-allowed",
    );
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--surface")
        .trim(),
    ).toBe(mode === "dark" ? "#222522" : "#fffefa");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  },
);
it("桌面与移动工具栏规则不能再使用广泛button后代选择器", () => {
  expect(stylesheet).not.toMatch(/\.writing-shortcuts\s+button(?:\s|:|\{)/);
  expect(stylesheet).toMatch(/\.writing-shortcuts\s*>\s*button\s*\{/);
  expect(stylesheet).toMatch(/\.writing-shortcuts\s*>\s*button:hover/);
});

it("预设目录输入组明确留间距且可换行，按钮不收缩", () => {
  render(
    <div className="button-group obsidian-directory-control">
      <input aria-label="路径" />
      <button className="button small">选择目录</button>
    </div>,
  );
  const input = screen.getByLabelText("路径");
  const button = screen.getByText("选择目录");
  const row = getComputedStyle(input.parentElement!);
  expect(row.display).toBe("flex");
  expect(row.flexWrap).toBe("wrap");
  expect(row.gap).toBe("8px");
  expect(getComputedStyle(button).flexShrink).toBe("0");
  expect(getComputedStyle(input).flexGrow).toBe("1");
  expect(getComputedStyle(input).minWidth).toBe("0px");
});
