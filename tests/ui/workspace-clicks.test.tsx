// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  defaultSettings,
  type Post,
  type APIToken,
} from "../../src/shared/contracts";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  api: h.api,
}));
vi.mock(
  "../../src/modules/navigation-performance/use-navigation-ready",
  () => ({ useNavigationReady: vi.fn() }),
);
vi.mock("../../src/modules/studio-navigation/pane", () => ({
  useStudioPane: () => ({ active: true, navigationKey: 0 }),
}));
import Dashboard from "../../src/components/content/Dashboard";
import Integrations from "../../src/components/integrations/Integrations";
const post = (id: string, extra: Partial<Post> = {}): Post => ({
  id,
  version: 1,
  title: id,
  slug: id,
  excerpt: "",
  blocks: [],
  category: "",
  tags: [],
  coverImage: "",
  visibility: "draft",
  pinned: false,
  publishedAt: null,
  updatedAt: "2026-10-27T00:00:00Z",
  deletedAt: null,
  ...extra,
});
const token = (id: string): APIToken => ({
  id,
  name: id,
  scopes: ["posts:read"],
  createdAt: "2026-10-27T00:00:00Z",
  expiresAt: "2026-11-27T00:00:00Z",
  lastUsedAt: null,
});
const initial = {
  posts: [
    post("草稿甲"),
    post("发布乙", {
      visibility: "unlisted",
      publishedAt: "2026-10-27T00:00:00Z",
    }),
  ],
  settings: defaultSettings,
  capabilities: {
    authenticated: true,
    aiConfigured: false,
    imageConfigured: false,
    storageConfigured: true,
    ownerConfigured: true,
  },
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  h.api.mockReset();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("文章列表真实 DOM 点击", () => {
  it("初始加载错误可见，不能伪装成功空列表", () => {
    render(
      <Dashboard
        initial={{ ...initial, posts: [] }}
        initialError="文章加载失败，请重试"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("文章加载失败");
  });
  it("草稿/发布/搜索切换显示正确结果且不发送写请求", () => {
    render(<Dashboard initial={initial} />);
    fireEvent.click(screen.getByRole("tab", { name: "草稿" }));
    expect(screen.queryByText("发布乙")).toBeNull();
    expect(screen.getByText("草稿甲")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "已发布" }));
    expect(screen.queryByText("草稿甲")).toBeNull();
    expect(screen.getByText("发布乙")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("搜索文章、标签…"), {
      target: { value: "不存在" },
    });
    expect(screen.queryByText("发布乙")).toBeNull();
    expect(h.api).not.toHaveBeenCalled();
  });
  it("删除确认取消不发送请求、不移除文章", () => {
    vi.mocked(confirm).mockReturnValue(false);
    render(<Dashboard initial={initial} />);
    fireEvent.click(screen.getAllByTitle("移入回收站")[0]);
    expect(h.api).not.toHaveBeenCalled();
    expect(screen.getByText("草稿甲")).toBeTruthy();
  });
  it("置顶失败显示错误且可重试，成功后更新按钮", async () => {
    h.api.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValueOnce({
      post: post("草稿甲", { pinned: true, version: 2 }),
    });
    render(<Dashboard initial={initial} />);
    fireEvent.click(screen.getAllByTitle("置顶文章")[0]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("网络中断"),
    );
    fireEvent.click(screen.getAllByTitle("置顶文章")[0]);
    await waitFor(() => expect(screen.getByTitle("取消置顶")).toBeTruthy());
    expect(h.api).toHaveBeenCalledTimes(2);
  });
  it("连续点击同一置顶按钮只产生一次请求", async () => {
    const pending = deferred<{ post: Post }>();
    h.api.mockReturnValue(pending.promise);
    render(<Dashboard initial={initial} />);
    const button = screen.getAllByTitle("置顶文章")[0];
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve({ post: post("草稿甲", { pinned: true, version: 2 }) }),
    );
  });
});

describe("连接面板真实 DOM 点击（API 仅隔离 mock）", () => {
  const setup = () =>
    render(
      <Integrations
        authenticated
        initialTokens={[token("令牌甲"), token("令牌乙")]}
      />,
    );
  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
    return screen.getByRole("dialog");
  };
  it("创建弹窗取消不发送请求，空名称禁止创建", () => {
    setup();
    const dialog = open();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "创建令牌",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.api).not.toHaveBeenCalled();
  });
  it("无效天数点击时协议拦截，不发送创建请求", () => {
    setup();
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText("用途名称"), {
      target: { value: "测试工具" },
    });
    fireEvent.change(within(dialog).getByLabelText("有效天数"), {
      target: { value: "0" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建令牌" }));
    expect(h.api).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("创建重复点击一次 POST，失败保持输入可重试", async () => {
    const pending = deferred<unknown>();
    h.api.mockReturnValueOnce(pending.promise);
    setup();
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText("用途名称"), {
      target: { value: "测试工具" },
    });
    const button = within(dialog).getByRole("button", { name: "创建令牌" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("创建失败")));
    expect(screen.getByRole("alert").textContent).toContain("创建失败");
    expect((screen.getByLabelText("用途名称") as HTMLInputElement).value).toBe(
      "测试工具",
    );
  });
  it("撤销取消不写入；成功后移除对应条目", async () => {
    setup();
    vi.mocked(confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getAllByTitle("撤销令牌")[0]);
    expect(h.api).not.toHaveBeenCalled();
    h.api.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getAllByTitle("撤销令牌")[0]);
    await waitFor(() => expect(screen.queryByText("令牌甲")).toBeNull());
    expect(screen.getByText("令牌乙")).toBeTruthy();
  });
  it("创建成功仅用 POST 回执显示一次凭据，隐藏后不再展示", async () => {
    h.api.mockResolvedValue({
      ...token("新工具"),
      token: "test-only-token-not-a-credential",
    });
    setup();
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText("用途名称"), {
      target: { value: "新工具" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建令牌" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("test-only-token-not-a-credential")).toBeTruthy();
    expect(screen.getByText("新工具")).toBeTruthy();
    expect(h.api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "我已保存，隐藏令牌" }));
    expect(screen.queryByText("test-only-token-not-a-credential")).toBeNull();
  });
  it("撤销请求期间阻止其他令牌竞争，顺序撤销不复活旧条目", async () => {
    const pending = deferred<unknown>();
    h.api.mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true });
    setup();
    const buttons = screen.getAllByTitle("撤销令牌");
    act(() => {
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[1]);
    });
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true }));
    expect(screen.queryByText("令牌甲")).toBeNull();
    fireEvent.click(screen.getByTitle("撤销令牌"));
    await waitFor(() => expect(screen.queryByText("令牌乙")).toBeNull());
    expect(screen.queryByText("令牌甲")).toBeNull();
  });
});
