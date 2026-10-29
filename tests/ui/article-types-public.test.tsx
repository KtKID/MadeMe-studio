// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import PublicFeed from "../../src/components/content/PublicFeed";
import Dashboard from "../../src/components/content/Dashboard";
import { defaultSettings, type Post } from "../../src/shared/contracts";

function openTypes(label: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  if (trigger.getAttribute("aria-expanded") !== "true")
    fireEvent.click(trigger);
  return screen.getByRole("listbox", { name: label });
}
function pickType(label: string, name: string) {
  fireEvent.click(
    within(openTypes(label)).getByRole("option", { name }),
  );
  expect(screen.queryByRole("listbox")).toBeNull();
}
const types = [
  { id: "ai", name: "AI" },
  { id: "reflection", name: "感悟" },
  { id: "empty", name: "空类型" },
];
const post = (
  id: string,
  category: string,
  categoryId?: string | null,
): Post & { categoryId?: string | null } => ({
  id,
  title: id,
  slug: id,
  category,
  ...(categoryId === undefined ? {} : { categoryId }),
  excerpt: "文章摘要",
  tags: ["TagNeedle"],
  blocks: [],
  coverImage: "",
  visibility: "public",
  pinned: false,
  version: 1,
  publishedAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
  deletedAt: null,
});
afterEach(cleanup);

it("首页下拉只按配置显示全部和类型，包含空类型；选择不导航并保留独立标签搜索", () => {
  const before = location.href;
  render(
    <PublicFeed
      posts={[
        post("one", "旧名字", "ai"),
        post("two", "感悟"),
        post("legacy", "旧分类"),
      ]}
      types={types}
      authenticated={false}
    />,
  );
  expect(
    within(openTypes("文章类型"))
      .getAllByRole("option")
      .map((x) => x.textContent),
  ).toEqual(["全部文章", "AI", "感悟", "空类型"]);
  pickType("文章类型", "AI");
  expect(screen.getByRole("heading", { name: "one" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "two" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "tagneedle" },
  });
  expect(screen.getByRole("heading", { name: "one" })).toBeTruthy();
  pickType("文章类型", "空类型");
  expect(screen.queryByRole("heading", { name: "one" })).toBeNull();
  expect(screen.getByText("没有找到相关文字")).toBeTruthy();
  pickType("文章类型", "全部文章");
  expect(screen.getByRole("heading", { name: "legacy" })).toBeTruthy();
  expect(location.href).toBe(before);
});

it("稳定ID更名仍命中，旧无ID文章按精确名字兼容；已删除ID不得冒充同名新类型", () => {
  render(
    <PublicFeed
      posts={[
        post("stable", "原类型", "ai"),
        post("old", "AI"),
        post("deleted", "AI", "removed"),
        post("case", "ai"),
      ]}
      types={types}
      authenticated={false}
    />,
  );
  pickType("文章类型", "AI");
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent),
  ).toEqual(["stable", "old"]);
  expect(screen.queryByText("原类型")).toBeNull();
});

it("后台类型列表包括配置空项，旧未配置分类仍可筛选且不改变文章", () => {
  const posts = [post("one", "旧名", "ai"), post("legacy", "旧分类")];
  render(
    <Dashboard
      initial={{
        settings: { ...defaultSettings, articleTypes: types },
        posts,
        capabilities: {
          authenticated: true,
          aiConfigured: false,
          imageConfigured: false,
          passwordConfigured: false,
          storageConfigured: true,
          ownerConfigured: true,
        },
      }}
    />,
  );
  expect(
    within(openTypes("按类型筛选")).getByRole("option", { name: "空类型" }),
  ).toBeTruthy();
  pickType("按类型筛选", "旧分类：旧分类");
  expect(screen.getByRole("heading", { name: "legacy" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "one" })).toBeNull();
  expect(posts[0].category).toBe("旧名");
  act(() =>
    window.dispatchEvent(
      new CustomEvent("mademe:article-types", {
        detail: [...types, { id: "new", name: "新增类型" }],
      }),
    ),
  );
  expect(
    within(openTypes("按类型筛选")).getByRole("option", { name: "新增类型" }),
  ).toBeTruthy();
});

it("后台正在筛选的类型被删除后撤下旧条件，不留下看不见的筛选", () => {
  render(
    <Dashboard
      initial={{
        settings: { ...defaultSettings, articleTypes: types },
        posts: [post("one", "AI", "ai"), post("two", "感悟", "reflection")],
        capabilities: {
          authenticated: true,
          aiConfigured: false,
          imageConfigured: false,
          passwordConfigured: false,
          storageConfigured: true,
          ownerConfigured: true,
        },
      }}
    />,
  );
  const select = screen.getByRole("combobox", { name: "按类型筛选" });
  pickType("按类型筛选", "AI");
  expect(screen.queryByRole("heading", { name: "two" })).toBeNull();
  act(() =>
    window.dispatchEvent(
      new CustomEvent("mademe:article-types", {
        detail: types.filter((type) => type.id !== "ai"),
      }),
    ),
  );
  expect(screen.getByRole("heading", { name: "two" })).toBeTruthy();
  expect(select.textContent).toContain("全部类型");
});

it("旧AI文章在更名后的首页和后台归入人工智能，历史名不是另一个可选类型", () => {
  const renamed = [{ id: "ai", name: "人工智能", legacyNames: ["AI"] }];
  const posts = [post("legacy-ai", "AI")];
  render(<PublicFeed posts={posts} types={renamed} authenticated={false} />);
  expect(
    within(openTypes("文章类型"))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["全部文章", "人工智能"]);
  pickType("文章类型", "人工智能");
  expect(screen.getByRole("heading", { name: "legacy-ai" })).toBeTruthy();
  expect(screen.queryByText("AI")).toBeNull();
  cleanup();
  render(
    <Dashboard
      initial={{
        settings: { ...defaultSettings, articleTypes: renamed },
        posts,
        capabilities: {
          authenticated: true,
          aiConfigured: false,
          imageConfigured: false,
          passwordConfigured: false,
          storageConfigured: true,
          ownerConfigured: true,
        },
      }}
    />,
  );
  expect(
    within(openTypes("按类型筛选")).queryByRole("option", {
      name: "旧分类：AI",
    }),
  ).toBeNull();
  pickType("按类型筛选", "人工智能");
  expect(screen.getByRole("heading", { name: "legacy-ai" })).toBeTruthy();
});
