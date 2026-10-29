// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Post } from "../../src/shared/contracts";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  api: h.api,
}));
import PublicFeed from "../../src/components/content/PublicFeed";
import Unlock from "../../src/components/content/Unlock";
import LoginPanel from "../../src/components/auth/LoginPanel";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const post = (id: string, category: string, pinned = false): Post => ({
  id,
  title: id,
  slug: id,
  category,
  pinned,
  version: 1,
  excerpt: "",
  tags: [id === "one" ? "TagNeedle" : "other"],
  blocks: [],
  coverImage: "",
  visibility: "public",
  publishedAt: "2026-10-27T00:00:00Z",
  updatedAt: "2026-10-27T00:00:00Z",
  deletedAt: null,
});
beforeEach(() => {
  h.api.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("公开列表真实 DOM 交互（不调用生产 API）", () => {
  it("分类、搜索标签、清空条件及文章链接目标一致", () => {
    render(
      <PublicFeed
        posts={[post("one", "技术"), post("two", "生活", true)]}
        types={[
          { id: "tech", name: "技术" },
          { id: "life", name: "生活" },
        ]}
        authenticated={false}
      />,
    );
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((n) => n.textContent),
    ).toEqual(["two", "one"]);
    fireEvent.change(screen.getByRole("combobox", { name: "文章类型" }), {
      target: { value: "tech" },
    });
    expect(screen.queryByRole("heading", { name: "two" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "tagneedle" },
    });
    expect(screen.getByRole("heading", { name: "one" })).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "阅读 one" })
        .every((n) => n.getAttribute("href") === "/p/one"),
    ).toBe(true);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有找到相关文字")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "写下第一篇文章" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "文章类型" }), {
      target: { value: "" },
    });
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
  });
  it("空列表只给作者显示写作入口", () => {
    render(<PublicFeed posts={[]} authenticated />);
    expect(
      screen.getByRole("link", { name: "写下第一篇文章" }).getAttribute("href"),
    ).toBe("/studio/new");
  });
});

describe("文章解锁真实 DOM 交互", () => {
  it("空密码即使直接触发表单也不请求", () => {
    const { container } = render(<Unlock slug="private" />);
    fireEvent.submit(container.querySelector("form")!);
    expect(h.api).not.toHaveBeenCalled();
  });
  it("同帧重复提交只解锁一次，失败保留输入且允许重试，成功只刷新一次", async () => {
    const pending = deferred<unknown>();
    h.api.mockReturnValueOnce(pending.promise);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const { container } = render(<Unlock slug="private slug" />);
    fireEvent.change(screen.getByLabelText("文章密码"), {
      target: { value: "fixture-password" },
    });
    act(() => {
      fireEvent.submit(container.querySelector("form")!);
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(h.api).toHaveBeenCalledWith("/api/posts/private%20slug/unlock", {
      method: "POST",
      body: JSON.stringify({ password: "fixture-password" }),
    });
    await act(async () => pending.reject(new Error("密码不正确")));
    expect(screen.getByRole("alert").textContent).toContain("密码不正确");
    expect((screen.getByLabelText("文章密码") as HTMLInputElement).value).toBe(
      "fixture-password",
    );
    h.api.mockResolvedValueOnce({ unlocked: true });
    fireEvent.click(screen.getByRole("button", { name: /解锁阅读/ }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(h.api).toHaveBeenCalledTimes(2);
  });
});

describe("作者登录真实 DOM 交互（fetch 与导航边界模拟）", () => {
  const session = {
    mode: "password" as const,
    configured: true,
    authenticated: false,
  };
  it("平台模式及不安全传输不显示独立密码输入", () => {
    const { rerender } = render(
      <LoginPanel
        session={{ mode: "sites", configured: true, authenticated: false }}
        returnTo="/studio"
      />,
    );
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(
      screen.getByRole("link", { name: "返回写作台" }).getAttribute("href"),
    ).toBe("/studio");
    rerender(
      <LoginPanel
        session={session}
        returnTo="/studio"
        secureTransport={false}
      />,
    );
    expect(screen.getByText("请使用安全连接")).toBeTruthy();
    expect(screen.queryByLabelText("密码")).toBeNull();
  });
  it("非法邮箱不会请求，显示协议校验错误", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { container } = render(
      <LoginPanel session={session} returnTo="/studio" secureTransport />,
    );
    fireEvent.change(screen.getByLabelText("作者邮箱"), {
      target: { value: "not-email" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "fixture-only" },
    });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "请输入有效邮箱和密码",
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("重复登录单次请求，失败清空密码并恢复按钮", async () => {
    const response = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetch);
    const { container } = render(
      <LoginPanel session={session} returnTo="//evil.test" secureTransport />,
    );
    fireEvent.change(screen.getByLabelText("作者邮箱"), {
      target: { value: "fixture@example.test" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "fixture-only" },
    });
    act(() => {
      fireEvent.submit(container.querySelector("form")!);
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).returnTo).toBe("/studio");
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
    await act(async () => response.resolve(new Response("", { status: 401 })));
    expect(screen.getByRole("alert").textContent).toContain("邮箱或密码不正确");
    expect(
      (screen.getByRole("button", { name: "登录" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("退出取消不请求，失败留在作者面板并展示错误", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <LoginPanel
        session={{ ...session, authenticated: true }}
        returnTo="/studio"
        secureTransport
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "退出作者账号" }));
    expect(fetch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "退出作者账号" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("操作未完成"),
    );
    expect(
      screen.getByRole("link", { name: "继续写作" }).getAttribute("href"),
    ).toBe("/studio");
  });
});
