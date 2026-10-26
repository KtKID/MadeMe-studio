import { describe, expect, it } from "vitest";
import { getEnv } from "../../src/server/runtime";
describe("Astro 运行时依赖注入", () => {
  it("只读取显式注入的env，不访问已移除的runtime.env", () => {
    const runtime = {
      get env() {
        throw new Error("已移除的适配器API");
      },
    };
    const env = { OWNER_ID: "test-owner" };
    expect(
      getEnv({
        request: new Request("https://example.test"),
        locals: { env, runtime },
      }),
    ).toBe(env);
  });
});
