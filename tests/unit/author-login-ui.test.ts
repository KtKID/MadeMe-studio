import { afterEach, expect, it, vi } from "vitest";
import { loginAuthor, logoutAuthor } from "../../src/components/auth/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import LoginPanel from "../../src/components/auth/LoginPanel";
afterEach(() => vi.unstubAllGlobals());
it("登录使用唯一协议、同源cookie，清洗服务端跳转", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ok: true, returnTo: "//evil.test" })),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await loginAuthor({
      email: "author@example.test",
      password: "test-only",
      returnTo: "/studio/media",
    }),
  ).toBe("/studio");
  expect(fetcher.mock.calls[0][1].credentials).toBe("same-origin");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).returnTo).toBe(
    "/studio/media",
  );
});
it("错误不回显服务端正文或密码且允许再次请求", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "sensitive-password" } }),
        { status: 401 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, returnTo: "/studio" })),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    loginAuthor({ email: "a@example.test", password: "test-only" }),
  ).rejects.toThrow("邮箱或密码不正确");
  expect(
    await loginAuthor({ email: "a@example.test", password: "test-only" }),
  ).toBe("/studio");
});
it("退出必须显式调用且校验回执", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: false })));
  vi.stubGlobal("fetch", fetcher);
  await expect(logoutAuthor()).rejects.toThrow();
  expect(fetcher.mock.calls[0][1].method).toBe("POST");
});
it("Sites和未配置模式不显示第二套密码表单", () => {
  for (const session of [
    { mode: "sites", configured: true, authenticated: false },
    { mode: "password", configured: false, authenticated: false },
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(LoginPanel, {
        session,
        returnTo: "/studio",
        secureTransport: true,
      }),
    );
    expect(html).not.toContain('type="password"');
  }
});
it("独立登录使用可访问的原生密码字段，已登录只显示显式退出", () => {
  const session = {
    mode: "password",
    configured: true,
    authenticated: false,
  } as const;
  const html = renderToStaticMarkup(
    createElement(LoginPanel, {
      session,
      returnTo: "/studio",
      secureTransport: true,
    }),
  );
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('method="post"');
  expect(html).toContain('action="/api/auth/login"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('for="author-password"');
  const signed = renderToStaticMarkup(
    createElement(LoginPanel, {
      session: { ...session, authenticated: true },
      returnTo: "/studio",
      secureTransport: true,
    }),
  );
  expect(signed).toContain("退出作者账号");
  expect(signed).not.toContain('type="password"');
});

it("HTTP登录页不渲染任何密码输入", () => {
  const html = renderToStaticMarkup(
    createElement(LoginPanel, {
      session: { mode: "password", configured: true, authenticated: false },
      returnTo: "/studio",
      secureTransport: false,
    }),
  );
  expect(html).toContain("HTTPS");
  expect(html).not.toContain('type="password"');
});
