// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Dropdown from "../../src/components/shared/Dropdown";
afterEach(cleanup);
const options = [
  { value: "public", label: "公开" },
  { value: "unlisted", label: "不公开列出" },
  { value: "password", label: "密码保护", disabled: true },
];
function setup(value = "public") {
  const change = vi.fn();
  render(
    <Dropdown
      label="谁可以阅读"
      value={value}
      options={options}
      className="extra"
      onChange={change}
    />,
  );
  return {
    change,
    trigger: screen.getByRole("combobox", { name: "谁可以阅读" }),
  };
}
it("禁用选项可见但不可点击，aria-disabled 标记", () => {
  const { change, trigger } = setup();
  expect(trigger.className).toContain("ui-dropdown-trigger");
  expect(trigger.className).toContain("extra");
  fireEvent.click(trigger);
  const locked = screen.getByRole("option", { name: "密码保护" });
  expect(locked.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(locked);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeTruthy();
});
it("方向键与 End 跳过禁用选项，循环回到第一个可用项", () => {
  const { change, trigger } = setup("unlisted");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "不公开列出" }).id,
  );
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "公开" }).id,
  );
  fireEvent.keyDown(trigger, { key: "End" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "不公开列出" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("unlisted");
});
it("当前值为禁用项时打开定位到第一个可用项", () => {
  const { trigger } = setup("password");
  expect(trigger.textContent).toBe("密码保护");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "公开" }).id,
  );
});
it("Escape 不冒泡到外层对话框的 document 监听", () => {
  const outer = vi.fn();
  document.addEventListener("keydown", outer);
  const { trigger } = setup();
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(outer).not.toHaveBeenCalled();
  document.removeEventListener("keydown", outer);
});
