import { describe, expect, it } from "vitest";
import { secureResponse } from "../src/server/response-policy";

// 防护必须经过中间件包装后仍成立，不能只测试 OAuth handler 的局部头部。
describe("Google OAuth 中间件安全策略", () => {
  it("callback 重定向不把 code/state 作为 Referer 传播", () => {
    const result = secureResponse(
      new Response(null, {
        status: 303,
        headers: { Location: "/studio", "Referrer-Policy": "no-referrer" },
      }),
      new URL(
        "https://site.test/api/auth/google/callback?code=secret&state=secret",
      ),
      "google",
    );
    expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  it.each(["/login", "/studio", "/studio/settings"])(
    "Google 作者页面 %s 不允许被嵌入",
    (path) => {
      const result = secureResponse(
        new Response("", { headers: { "Content-Type": "text/html" } }),
        new URL(`https://site.test${path}`),
        "google",
      );
      expect(result.headers.get("Content-Security-Policy")).toContain(
        "frame-ancestors 'none'",
      );
    },
  );
  it("Google 登录页仅额外允许固定 Google 目的地的表单重定向", () => {
    const result = secureResponse(
      new Response("", { headers: { "Content-Type": "text/html" } }),
      new URL("https://site.test/login"),
      "google",
    );
    expect(result.headers.get("Content-Security-Policy")).toContain(
      "form-action 'self' https://accounts.google.com;",
    );
    // no-referrer 会令原生表单 POST 发送 Origin: null 并被 CSRF 校验拒绝。
    expect(result.headers.get("Referrer-Policy")).toBe("same-origin");
  });
  it.each(["google", "password", "sites"])(
    "%s 模式 /login 不使用 no-referrer，保证同源表单携带真实 Origin",
    (mode) => {
      const result = secureResponse(
        new Response("", { headers: { "Content-Type": "text/html" } }),
        new URL("https://site.test/login"),
        mode,
      );
      expect(result.headers.get("Referrer-Policy")).toBe("same-origin");
    },
  );
  it.each(["/api/auth/google/start", "/api/auth/session", "/api/auth/logout"])(
    "认证接口 %s 保持 no-referrer",
    (path) => {
      const result = secureResponse(
        new Response(null, { status: 303, headers: { Location: "/" } }),
        new URL(`https://site.test${path}`),
        "google",
      );
      expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
    },
  );
  it.each(["sites", "password"])("不扩大 %s 模式表单的外站权限", (mode) => {
    const result = secureResponse(
      new Response("", { headers: { "Content-Type": "text/html" } }),
      new URL("https://site.test/login"),
      mode,
    );
    expect(result.headers.get("Content-Security-Policy")).not.toContain(
      "accounts.google.com",
    );
  });
});
