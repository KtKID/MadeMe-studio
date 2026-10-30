import { expect, it } from "vitest";
import {
  harnessTaskInputSchema,
  harnessApiKeySchema,
} from "../../integrations/codex-harness/contracts";
it("默认严格replay，录制必须显式确认可能计费且指定安全模型ID", () => {
  const task = {
    requestId: crypto.randomUUID(),
    kind: "polish-selection",
    input: "公开样本",
    model: "gpt-test",
  };
  expect(harnessTaskInputSchema.parse(task)).toMatchObject({
    mode: "replay",
    recordConsent: false,
  });
  expect(
    harnessTaskInputSchema.safeParse({ ...task, mode: "record" }).success,
  ).toBe(false);
  expect(
    harnessTaskInputSchema.safeParse({ ...task, model: "../x" }).success,
  ).toBe(false);
});
it("API key只允许严格专用输入字段，不接受持久化或认证旁路字段", () => {
  expect(
    harnessApiKeySchema.safeParse({ apiKey: "sk-fixture-only" }).success,
  ).toBe(true);
  expect(
    harnessApiKeySchema.safeParse({ apiKey: "sk-fixture-only", persist: true })
      .success,
  ).toBe(false);
  expect(harnessApiKeySchema.safeParse({ apiKey: " x\n" }).success).toBe(false);
  expect(harnessApiKeySchema.safeParse({ apiKey: "sk fixture" }).success).toBe(
    false,
  );
});
