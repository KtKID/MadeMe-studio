// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  api: mock.api,
}));
import TypeSelector from "../../src/modules/article-types/TypeSelector";
import TypeSettings from "../../src/modules/article-types/TypeSettings";
// 通过真实按钮和弹层选项交互，避免把原生 select 的 change 伪装成自定义控件点击。
function openTypes() {
  const trigger = screen.getByRole("combobox", { name: "文章类型" });
  if (trigger.getAttribute("aria-expanded") !== "true")
    fireEvent.click(trigger);
  return screen.getByRole("listbox", { name: "文章类型" });
}
function pickType(name: string) {
  fireEvent.click(
    within(openTypes()).getByRole("option", { name }),
  );
  expect(screen.queryByRole("listbox")).toBeNull();
}
const types = [
  { id: "ai", name: "AI" },
  { id: "reflection", name: "感悟" },
];
function Selector({
  change = vi.fn(),
  legacy = "",
}: {
  change?: (id: string | null, name: string) => void;
  legacy?: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <TypeSelector
      initialTypes={types}
      value={value}
      legacyName={legacy}
      onChange={(id, name) => {
        setValue(id);
        change(id, name);
      }}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  mock.api.mockImplementation(async (_url: string, options?: RequestInit) =>
    options?.method === "POST"
      ? { types: [...types, { id: "new", name: "设计" }], selectedId: "new" }
      : { types },
  );
});
it("加载类型并保留未配置旧分类，不因加载自动修改文章", async () => {
  const change = vi.fn();
  render(<Selector change={change} legacy="旧分类" />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  expect(
    within(openTypes()).getByRole("option", { name: /旧分类/ }),
  ).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
});
it("在选择器内新增成功自动选中，设置列表立即同步", async () => {
  const change = vi.fn();
  render(
    <>
      <Selector change={change} />
      <TypeSettings initialTypes={types} />
    </>,
  );
  await waitFor(() => expect(mock.api).toHaveBeenCalledTimes(2));
  pickType("＋ 新增类型…");
  fireEvent.change(screen.getByLabelText("新类型名称"), {
    target: { value: "设计" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加并选中" }));
  await waitFor(() => expect(change).toHaveBeenCalledWith("new", "设计"));
  expect(
    screen.getByRole("combobox", { name: "文章类型" }).textContent,
  ).toContain("设计");
  expect(screen.getByRole("button", { name: "编辑设计" })).toBeTruthy();
});
it("空白和已有名称不能新增，失败保留输入并可重试", async () => {
  render(<Selector />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  pickType("＋ 新增类型…");
  const input = screen.getByLabelText("新类型名称");
  const add = screen.getByRole("button", { name: "添加并选中" });
  expect(add).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: " ai " } });
  expect(add).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: "设计" } });
  mock.api.mockRejectedValueOnce(new Error("保存失败"));
  fireEvent.click(add);
  await screen.findByText("保存失败");
  expect(input).toHaveProperty("value", "设计");
  fireEvent.click(add);
  await waitFor(() => expect(screen.queryByLabelText("新类型名称")).toBeNull());
});
it("新增等待时防止重复提交，取消后迟到成功不改变文章选择", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => (resolve = r));
  const change = vi.fn();
  render(<Selector change={change} />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  mock.api.mockImplementationOnce(() => pending);
  pickType("＋ 新增类型…");
  fireEvent.change(screen.getByLabelText("新类型名称"), {
    target: { value: "设计" },
  });
  const add = screen.getByRole("button", { name: "添加并选中" });
  fireEvent.click(add);
  fireEvent.click(add);
  await waitFor(() =>
    expect(
      mock.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1),
  );
  fireEvent.click(screen.getByRole("button", { name: "取消新增" }));
  await act(async () =>
    resolve({
      types: [...types, { id: "new", name: "设计" }],
      selectedId: "new",
    }),
  );
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("新类型名称")).toBeNull();
});
it("加载失败给出重试而不清旧选择", async () => {
  mock.api.mockRejectedValueOnce(new Error("网络暂不可用"));
  render(<Selector legacy="旧类型" />);
  await screen.findByText("网络暂不可用");
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  await waitFor(() => expect(screen.queryByText("网络暂不可用")).toBeNull());
  expect(
    within(openTypes()).getByRole("option", { name: /旧类型/ }),
  ).toBeTruthy();
});
it("删除用站内确认，可取消且不会直接写入", async () => {
  render(<TypeSettings initialTypes={types} />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "删除AI" }));
  const dialog = screen.getByRole("dialog", { name: "删除文章类型" });
  expect(within(dialog).getByText(/已有文章/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(
    mock.api.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
});

it("重命名提交稳定ID，不更改其它类型；后续可删除", async () => {
  mock.api.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (!options?.method) return { types };
    const command = JSON.parse(options.body as string);
    return command.action === "rename"
      ? { types: [{ id: "ai", name: "人工智能" }, types[1]] }
      : { types: [types[1]] };
  });
  render(<TypeSettings initialTypes={types} />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "编辑AI" }));
  fireEvent.change(screen.getByLabelText("类型名称"), {
    target: { value: "人工智能" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
  await screen.findByRole("button", { name: "编辑人工智能" });
  const command = JSON.parse(
    mock.api.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
  );
  expect(command).toEqual({ action: "rename", id: "ai", name: "人工智能" });
  fireEvent.click(screen.getByRole("button", { name: "删除人工智能" }));
  fireEvent.click(screen.getByRole("button", { name: "删除类型" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "编辑人工智能" })).toBeNull();
});

it("早发出的GET迟到不能覆盖新增成功广播", async () => {
  let finish!: (value: unknown) => void;
  mock.api.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  render(<Selector />);
  pickType("＋ 新增类型…");
  fireEvent.change(screen.getByLabelText("新类型名称"), {
    target: { value: "设计" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加并选中" }));
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "文章类型" }).textContent,
    ).toContain("设计"),
  );
  await act(async () => finish({ types }));
  expect(
    within(openTypes()).getByRole("option", { name: "设计" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("combobox", { name: "文章类型" }).textContent,
  ).toContain("设计");
});

it("外层保存禁用时不允许更改类型或继续新增", async () => {
  const props = {
    initialTypes: types,
    value: null,
    legacyName: "",
    onChange: vi.fn(),
  };
  const view = render(<TypeSelector {...props} />);
  pickType("＋ 新增类型…");
  view.rerender(<TypeSelector {...props} disabled />);
  expect(screen.getByLabelText("文章类型")).toHaveProperty("disabled", true);
  expect(screen.queryByLabelText("新类型名称")).toBeNull();
});

it("控件使用共享按钮类和主题token，操作区可换行且不使用原生确认", async () => {
  render(<TypeSettings initialTypes={types} />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  for (const button of screen.getAllByRole("button"))
    expect(button.classList.contains("button")).toBe(true);
  const css = readFileSync("src/modules/article-types/styles.css", "utf8");
  expect(css).toContain("var(--surface)");
  expect(css).toContain("var(--line)");
  expect(css).toContain("flex-wrap: wrap");
  const source = readFileSync(
    "src/modules/article-types/TypeSettings.tsx",
    "utf8",
  );
  expect(source).toContain("<Modal");
  expect(source).not.toMatch(/window\.(alert|confirm)|\bconfirm\(/);
});

it("同页不同组件的类型写入串行，迟到响应不会把共享列表倒退", async () => {
  const { mutateArticleTypes } =
    await import("../../src/modules/article-types/client");
  let release!: (value: unknown) => void;
  mock.api.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  const first = mutateArticleTypes({ action: "create", name: "设计" });
  const second = mutateArticleTypes({ action: "create", name: "生活" });
  await Promise.resolve();
  const countBefore = mock.api.mock.calls.length;
  release({
    types: [...types, { id: "new", name: "设计" }],
    selectedId: "new",
  });
  await Promise.all([first, second]);
  expect(countBefore).toBe(1);
  expect(mock.api).toHaveBeenCalledTimes(2);
});

it("新增不能占用其他类型旧名称，编辑可改回自身旧名称", async () => {
  const withAliases = [
    { id: "ai", name: "人工智能", legacyNames: ["AI"] },
    types[1],
  ];
  mock.api.mockResolvedValue({ types: withAliases });
  render(<TypeSettings initialTypes={withAliases} />);
  await waitFor(() => expect(mock.api).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "新增类型" }));
  fireEvent.change(screen.getByLabelText("新类型名称"), {
    target: { value: "ai" },
  });
  expect(screen.getByRole("button", { name: "添加类型" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "取消新增" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑人工智能" }));
  fireEvent.change(screen.getByLabelText("类型名称"), {
    target: { value: "AI" },
  });
  expect(screen.getByRole("button", { name: "保存名称" })).toHaveProperty(
    "disabled",
    false,
  );
});

it("旧分类按历史名称显示当前类型，但不自动改写文章；未知显式ID不抢占同名", async () => {
  const renamed = [{ id: "ai", name: "人工智能", legacyNames: ["AI"] }];
  mock.api.mockResolvedValue({ types: renamed });
  const change = vi.fn();
  const props = { initialTypes: renamed, legacyName: "AI", onChange: change };
  const view = render(<TypeSelector {...props} value={null} />);
  expect(
    screen.getByRole("combobox", { name: "文章类型" }).textContent,
  ).toContain("人工智能");
  expect(change).not.toHaveBeenCalled();
  view.rerender(<TypeSelector {...props} value="deleted" />);
  expect(
    screen.getByRole("combobox", { name: "文章类型" }).textContent,
  ).toContain("AI（原分类）");
});

it("队列里一个写入失败后下一项仍会执行", async () => {
  const { mutateArticleTypes } =
    await import("../../src/modules/article-types/client");
  mock.api.mockRejectedValueOnce(new Error("失败"));
  const first = mutateArticleTypes({ action: "create", name: "设计" }).catch(
    (error) => error.message,
  );
  const second = mutateArticleTypes({ action: "create", name: "生活" });
  expect(await first).toBe("失败");
  expect((await second).selectedId).toBe("new");
  expect(mock.api).toHaveBeenCalledTimes(2);
});
