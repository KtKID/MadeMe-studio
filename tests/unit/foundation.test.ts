import { describe, expect, it } from "vitest";
import { healthSchema } from "../../src/shared/foundation";

describe("基础协议", () => {
  it("健康状态必须通过统一协议校验", () => {
    expect(
      healthSchema.parse({
        status: "ok",
        service: "MadeMe Studio",
        version: "0.1.0",
      }).status,
    ).toBe("ok");
  });
  it("拒绝错误状态和额外字段", () => {
    expect(healthSchema.safeParse({ status: "broken" }).success).toBe(false);
    expect(
      healthSchema.safeParse({
        status: "ok",
        service: "MadeMe Studio",
        version: "0.1.0",
        secret: "x",
      }).success,
    ).toBe(false);
  });
});
