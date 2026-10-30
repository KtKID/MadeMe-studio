import { describe, expect, it } from "vitest";
import {
  harnessTaskInputSchema,
  harnessLoginSchema,
  harnessStatusSchema,
} from "../../integrations/codex-harness/contracts";
describe("独立 harness 业务边界", () => {
  it("仅允许白名单任务，不接受 shell、路径或凭据", () => {
    expect(
      harnessTaskInputSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: "polish-selection",
        input: "你好",
      }).success,
    ).toBe(true);
    expect(
      harnessTaskInputSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: "shell",
        input: "pwd",
      }).success,
    ).toBe(false);
    expect(
      harnessTaskInputSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: "polish-selection",
        input: "你好",
        cwd: "/",
      }).success,
    ).toBe(false);
  });
  it("网页登录只允许官方 HTTPS 地址", () => {
    expect(
      harnessLoginSchema.safeParse({
        loginId: "l1",
        authUrl: "https://auth.openai.com/authorize?a=1",
      }).success,
    ).toBe(true);
    for (const authUrl of [
      "http://auth.openai.com/x",
      "https://auth.openai.com.evil.test/x",
      "https://u@chatgpt.com/x",
      "https://chatgpt.com:444/x",
    ])
      expect(
        harnessLoginSchema.safeParse({ loginId: "l1", authUrl }).success,
      ).toBe(false);
  });
  it("状态不接受账户秘密或随意能力", () => {
    expect(
      harnessStatusSchema.safeParse({
        connected: true,
        authenticated: false,
        browserLoginAvailable: false,
        capabilities: { polishSelection: true, imageGeneration: false },
        token: "secret",
      }).success,
    ).toBe(false);
  });
});
