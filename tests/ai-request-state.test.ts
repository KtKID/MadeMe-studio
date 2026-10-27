import { describe, expect, it } from "vitest";
import { AIRequestState } from "../src/components/editor/ai-request-state";
describe("AI 建议会话", () => {
  it("关闭/重开或改变处理动作后，迟到建议失效", () => {
    const session = new AIRequestState();
    const request = session.snapshot();
    expect(session.isCurrent(request)).toBe(true);
    session.invalidate();
    expect(session.isCurrent(request)).toBe(false);
    const next = session.snapshot();
    expect(session.isCurrent(next)).toBe(true);
  });
});
