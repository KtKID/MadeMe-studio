import { describe, it, expect } from "vitest";
import {
  initialPublishVisibility,
  publicationAvailability,
} from "../src/components/editor/publishing-state";
describe("密码发布的配置边界", () => {
  it("缺少配置时只禁用密码发布并解释SESSION_SECRET", () => {
    const result = publicationAvailability("password", false);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("SESSION_SECRET");
    expect(publicationAvailability("public", false).allowed).toBe(true);
    expect(publicationAvailability("unlisted", false).allowed).toBe(true);
  });
  it("已有密码文章即使配置暂失也不默默改为公开", () => {
    expect(initialPublishVisibility("password")).toBe("password");
    expect(initialPublishVisibility("unlisted")).toBe("unlisted");
    expect(initialPublishVisibility("draft")).toBe("public");
  });
  it("确认服务端密码配置可用后允许密码发布", () => {
    expect(publicationAvailability("password", true)).toEqual({
      allowed: true,
      message: "",
    });
  });
});
