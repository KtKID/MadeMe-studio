import { describe, expect, it } from "vitest";
import { secureResponse } from "../../src/server/response-policy";
describe("响应隔离策略", () => {
  it("HTML不进入共享缓存，管理页不可索引", () => {
    const r = secureResponse(
      new Response("private", { headers: { "Content-Type": "text/html" } }),
      new URL("https://example.com/studio"),
    );
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("保留静态文件缓存和现有响应状态", () => {
    const r = secureResponse(
      new Response("css", {
        status: 200,
        headers: {
          "Content-Type": "text/css",
          "Cache-Control": "public, max-age=31536000",
        },
      }),
      new URL("https://example.com/_astro/x.css"),
    );
    expect(r.headers.get("cache-control")).toContain("31536000");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
