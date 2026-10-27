// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import LoginPanel from "../../src/components/auth/LoginPanel";
const session = {
  mode: "google" as const,
  configured: true,
  authenticated: false,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Google 单作者登录的真实组件 DOM 与无脚本表单", () => {
  it("服务端表单无需水合即可同源 POST，拒绝外部回跳且不含凭据字段", () => {
    const html = renderToStaticMarkup(
      <LoginPanel session={session} returnTo="//evil.test" secureTransport />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(doc.querySelector("form")?.getAttribute("action")).toBe(
      "/api/auth/google/start",
    );
    expect(
      doc.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value,
    ).toBe("/studio");
    expect(
      doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(false);
    expect(
      doc.querySelector('input[type="email"],input[type="password"]'),
    ).toBeNull();
    expect(html).toContain("不开放注册");
  });
  it.each(["/\\evil.test", "/%2fevil.test", "https://evil.test", "/studio\n"])(
    "拒绝危险回跳 %s",
    (returnTo) => {
      const { container } = render(
        <LoginPanel session={session} returnTo={returnTo} secureTransport />,
      );
      expect(
        container.querySelector<HTMLInputElement>('input[name="returnTo"]')
          ?.value,
      ).toBe("/studio");
    },
  );
  it("保留合法站内目标；首个提交交给浏览器，重复提交拦截，浏览器返回后可重试", () => {
    const { container } = render(
      <LoginPanel
        session={session}
        returnTo="/studio?tab=settings#author"
        secureTransport
      />,
    );
    const form = container.querySelector("form")!;
    expect(new FormData(form).get("returnTo")).toBe(
      "/studio?tab=settings#author",
    );
    expect(fireEvent.submit(form)).toBe(true);
    expect(fireEvent.submit(form)).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: /正在前往 Google/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(
      (
        screen.getByRole("button", {
          name: "使用 Google 登录",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(fireEvent.submit(form)).toBe(true);
  });
  it.each([false, true])(
    "配置缺失时无登录表单（HTTPS=%s）",
    (secureTransport) => {
      const { container } = render(
        <LoginPanel
          session={{ ...session, configured: false }}
          returnTo="/studio"
          secureTransport={secureTransport}
        />,
      );
      expect(container.querySelector("form")).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
    },
  );
  it("HTTP 不显示 Google 登录入口", () => {
    const { container } = render(
      <LoginPanel session={session} returnTo="/studio" />,
    );
    expect(screen.getByRole("status").textContent).toContain("HTTPS");
    expect(container.querySelector("form")).toBeNull();
  });
  it.each(["google_denied", "google_failed"])(
    "回调拒绝或失败显示固定提示，可重新开始 %s",
    (loginError) => {
      render(
        <LoginPanel
          session={session}
          returnTo="/studio"
          secureTransport
          loginError={loginError}
        />,
      );
      expect(screen.getByRole("alert").textContent).toMatch(/未完成|未获授权/);
      expect(
        (
          screen.getByRole("button", {
            name: "使用 Google 登录",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );
  it("不回显未识别的错误参数", () => {
    render(
      <LoginPanel
        session={session}
        returnTo="/studio"
        secureTransport
        loginError="secret@example.test"
      />,
    );
    expect(screen.queryByText(/secret@example.test/)).toBeNull();
  });
  it("无脚本已认证面板保留站内入口，退出不能误作 GET", () => {
    const html = renderToStaticMarkup(
      <LoginPanel
        session={{ ...session, authenticated: true }}
        returnTo="//evil.test"
        secureTransport
      />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("/studio");
    expect(doc.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
    expect(doc.querySelector("form")).toBeNull();
  });
  it("Google 作者重复退出同帧只发送一次 POST", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetch = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <LoginPanel
        session={{ ...session, authenticated: true }}
        returnTo="/studio"
        secureTransport
      />,
    );
    const button = screen.getByRole("button", { name: "退出作者账号" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => resolve(new Response("", { status: 500 })));
    expect(screen.getByRole("alert").textContent).toContain("操作未完成");
    expect(
      (
        screen.getByRole("button", {
          name: "退出作者账号",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("已认证作者不再显示登录表单，退出取消不请求，失败保留作者入口", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = render(
      <LoginPanel
        session={{ ...session, authenticated: true }}
        returnTo="/studio"
        secureTransport
      />,
    );
    expect(container.querySelector("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "退出作者账号" }));
    expect(fetch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "退出作者账号" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("操作未完成"),
    );
    expect(fetch.mock.calls[0][0]).toBe("/api/auth/logout");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(
      screen.getByRole("link", { name: "继续写作" }).getAttribute("href"),
    ).toBe("/studio");
  });
});
