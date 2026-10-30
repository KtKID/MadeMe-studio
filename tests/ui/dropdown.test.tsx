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
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "公开" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("public");
});
it("重新选择当前值只关闭菜单，不触发 onChange（原生 select 语义）", () => {
  const { change, trigger } = setup("unlisted");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: "不公开列出" }));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
it("选项数量不变但禁用状态变化时，活动项移出新禁用项", () => {
  const change = vi.fn();
  const make = (lockUnlisted: boolean) => [
    { value: "public", label: "公开" },
    { value: "unlisted", label: "不公开列出", disabled: lockUnlisted },
    { value: "password", label: "密码保护" },
  ];
  const { rerender } = render(
    <Dropdown
      label="范围"
      value="public"
      options={make(false)}
      onChange={change}
    />,
  );
  const trigger = screen.getByRole("combobox", { name: "范围" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "不公开列出" }).id,
  );
  rerender(
    <Dropdown
      label="范围"
      value="public"
      options={make(true)}
      onChange={change}
    />,
  );
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "公开" }).id,
  );
  // 仍可用的活动项保持不动。
  fireEvent.keyDown(trigger, { key: "End" });
  rerender(
    <Dropdown
      label="范围"
      value="public"
      options={make(false)}
      onChange={change}
    />,
  );
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "密码保护" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("password");
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
