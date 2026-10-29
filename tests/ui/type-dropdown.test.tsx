// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import TypeDropdown from "../../src/modules/article-types/TypeDropdown";
const options = [{ value: "", label: "未分类" }, { value: "ai", label: "AI" }, { value: "reflection", label: "感悟" }];
afterEach(cleanup);
function setup(extra = {}) { const change = vi.fn(); render(<><TypeDropdown label="文章类型" value="ai" options={options} onChange={change} {...extra} /><button>下一个</button></>); return { change, trigger: screen.getByRole("combobox", { name: "文章类型" }) }; }
it("真实自定义 listbox 选中后关闭并还焦点，不再渲染原生 select", () => {
 const { change, trigger } = setup();
 expect(document.querySelector("select")).toBeNull();
 fireEvent.click(trigger);
 expect(screen.getByRole("listbox")).toBeTruthy();
 expect(screen.getByRole("option", { name: "AI" }).getAttribute("aria-selected")).toBe("true");
 fireEvent.click(screen.getByRole("option", { name: "感悟" }));
 expect(change).toHaveBeenCalledWith("reflection");
 expect(screen.queryByRole("listbox")).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it("方向键/Home/End/Enter 选择，Escape 取消不改变值", () => {
 const { change, trigger } = setup(); trigger.focus();
 fireEvent.keyDown(trigger, { key: "ArrowDown" });
 fireEvent.keyDown(trigger, { key: "End" });
 expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "感悟" }).id);
 fireEvent.keyDown(trigger, { key: "Home" });
 fireEvent.keyDown(trigger, { key: "ArrowDown" });
 fireEvent.keyDown(trigger, { key: "Enter" }); expect(change).toHaveBeenCalledWith("ai");
 fireEvent.keyDown(trigger, { key: " " }); fireEvent.keyDown(trigger, { key: "ArrowUp" }); fireEvent.keyDown(trigger, { key: "Escape" });
 expect(change).toHaveBeenCalledTimes(1); expect(screen.queryByRole("listbox")).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it("Tab、外部点击与外部焦点关闭，不夺回焦点", () => {
 const { trigger } = setup(); fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: "Tab" });
 const next = screen.getByRole("button", { name: "下一个" }); next.focus(); expect(screen.queryByRole("listbox")).toBeNull(); expect(document.activeElement).toBe(next);
 fireEvent.click(trigger); fireEvent.pointerDown(next); next.focus(); expect(screen.queryByRole("listbox")).toBeNull(); expect(document.activeElement).toBe(next);
 fireEvent.click(trigger); fireEvent.focusIn(next); expect(screen.queryByRole("listbox")).toBeNull();
});
it("禁用、空列表与服务端水合前都不可展开", () => {
 const { trigger } = setup({ disabled: true }); fireEvent.click(trigger); expect(screen.queryByRole("listbox")).toBeNull(); expect((trigger as HTMLButtonElement).disabled).toBe(true);
 cleanup(); setup({ options: [] }); expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
 const html = renderToString(<TypeDropdown label="文章类型" value="ai" options={options} onChange={() => {}} />);
 expect(new DOMParser().parseFromString(html, "text/html").querySelector("button")?.disabled).toBe(true);
});
it("弹层脱离裁切父容器并限制视口内边界，可滚动长列表", () => {
 const { trigger } = setup(); vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 990, right: 1090, top: 730, bottom: 770, width: 100, height: 40, x: 990, y: 730, toJSON() {} });
 fireEvent.click(trigger); const list = screen.getByRole("listbox");
 expect(list.parentElement).toBe(document.body); expect(list.style.position).toBe("fixed");
 expect(parseFloat(list.style.left) + parseFloat(list.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
 expect(parseFloat(list.style.maxHeight)).toBeGreaterThan(0);
 expect(list.getAttribute("data-placement")).toBe("top");
});
it("外部值和选项变化更新选中项，禁用时移除弹层", () => {
 const { trigger } = setup(); fireEvent.click(trigger); cleanup();
 const { rerender } = render(<TypeDropdown label="文章类型" value="ai" options={options} onChange={() => {}} />);
 fireEvent.click(screen.getByRole("combobox"));
 rerender(<TypeDropdown label="文章类型" value="reflection" options={options} disabled onChange={() => {}} />);
 expect(screen.getByRole("combobox").textContent).toContain("感悟"); expect(screen.queryByRole("listbox")).toBeNull();
});
it("弹层在窗口与页面滚动后重新测量，卸载后无遗留菜单", () => {
 const { trigger } = setup(); let left = 30;
 vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => ({ left, right: left + 200, top: 50, bottom: 90, width: 200, height: 40, x: left, y: 50, toJSON() {} }));
 fireEvent.click(trigger); expect(screen.getByRole("listbox").style.left).toBe("30px");
 left = 70; fireEvent.resize(window); expect(screen.getByRole("listbox").style.left).toBe("70px");
 left = 90; fireEvent.scroll(window); expect(screen.getByRole("listbox").style.left).toBe("90px");
 cleanup(); fireEvent.scroll(window); expect(screen.queryByRole("listbox")).toBeNull();
});
it("样式继承暗色/换肤变量，保留选中/焦点与滚动，过滤器不叠双边框", async () => {
 const { readFileSync } = await import("node:fs");
 const css = readFileSync("src/modules/article-types/type-dropdown.css", "utf8");
 for (const token of ["--surface", "--surface-raised", "--ink", "--line", "--accent", "--tint", "--tint-strong"]) expect(css).toContain(`var(${token})`);
 expect(css).toContain(":focus-visible"); expect(css).toContain("overflow-y: auto"); expect(css).toContain("overscroll-behavior: contain");
 expect(css).toMatch(/\.category-filter\.article-type-filter\s*\{\s*padding: 0; border: 0;/);
});
it("鼠标展开不叠加金色外圈，键盘焦点只保留单一内描边", async () => {
 const { readFileSync } = await import("node:fs");
 const css = readFileSync("src/modules/article-types/type-dropdown.css", "utf8");
 const focus = css.match(/\.article-type-dropdown-trigger:focus-visible\s*\{([^}]+)\}/)?.[1] ?? "";
 expect(focus).toContain("outline: none");
 expect(focus).toContain("border-color: transparent");
 expect(focus).toContain("box-shadow: inset 0 0 0 2px var(--accent)");
 const hover = css.match(/\.article-type-dropdown-trigger:hover:not\(:disabled\)\s*\{([^}]+)\}/)?.[1] ?? "";
 const expanded = css.match(/\.article-type-dropdown-trigger\[aria-expanded="true"\]\s*\{([^}]+)\}/)?.[1] ?? "";
 expect(hover).not.toContain("border-color: var(--accent)");
 expect(expanded).not.toContain("border-color: var(--accent)");
 expect(css).toMatch(/\.article-type-dropdown-trigger\s*\{[^}]*box-shadow: none/s);
});
