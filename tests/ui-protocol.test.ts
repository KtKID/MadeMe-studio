import { describe, it, expect } from "vitest";
import {
  parseApiResponse,
  parseApiError,
} from "../src/components/shared/api-protocol";
// 前端也验证跨网络边界的协议，不能以 TypeScript 强制转换代替运行时校验。
describe("界面 API 协议校验", () => {
  it("拒绝形状不完整的文章", () => {
    expect(() =>
      parseApiResponse({ post: { id: "incomplete" } }, "/api/posts/id", "GET"),
    ).toThrow();
  });
  it("拒绝不合法媒体类型结构", () => {
    expect(() =>
      parseApiResponse(
        { media: [{ name: "test", url: 42 }] },
        "/api/media",
        "GET",
      ),
    ).toThrow();
  });
  it("接受 AI 文字而不将其当成 HTML", () => {
    expect(
      parseApiResponse({ text: "<b>建议</b>" }, "/api/ai", "POST"),
    ).toEqual({
      text: "<b>建议</b>",
    });
  });
  it("服务端错误不完整时返回明确后备文案", () => {
    expect(
      parseApiError({ error: { code: "CONFLICT", message: "冲突" } }),
    ).toEqual({ code: "CONFLICT", message: "冲突" });
    expect(parseApiError(null).code).toBe("REQUEST_FAILED");
  });
});

describe("明确响应端点", () => {
  it("拒绝未知端点或未知success对象", () => {
    expect(() =>
      parseApiResponse({ ok: true }, "/api/not-real", "GET"),
    ).toThrow();
    expect(() =>
      parseApiResponse({ ok: true }, "/api/settings", "PATCH"),
    ).toThrow();
  });
  it("成功确认也使用专用Zod", () => {
    expect(
      parseApiResponse({ revoked: true }, "/api/tokens/id", "DELETE"),
    ).toEqual({ revoked: true });
    expect(() =>
      parseApiResponse({ revoked: false }, "/api/tokens/id", "DELETE"),
    ).toThrow();
  });
});

it("DELETE /api/media/:id 带 ?force=1 时仍按删除响应 schema 校验", () => {
  const ok = { deleted: true, clearedCovers: [{ postId: "p", version: 2 }] };
  expect(parseApiResponse(ok, "/api/media/abc?force=1", "DELETE")).toEqual(ok);
  expect(parseApiResponse(ok, "/api/media/abc", "DELETE")).toEqual(ok);
  expect(() =>
    parseApiResponse({ deleted: true }, "/api/media/abc?force=1", "DELETE"),
  ).toThrow();
});
