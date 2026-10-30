import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ stale: false }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      if (h.stale && String(args[0]).endsWith(".json")) {
        h.stale = false;
        throw Object.assign(new Error("stale absent"), { code: "ENOENT" });
      }
      return fs.lstat(...args);
    },
  };
});
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HarnessRecorder,
  PUBLIC_TEST_INPUTS,
} from "../integrations/codex-harness/recording";
let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("begin先前观察不存在后，另一次录制刚完成，获取占位后仍须重新核文件", async () => {
  directory = await mkdtemp(join(tmpdir(), "recording-race-"));
  const input = {
    kind: "polish-selection" as const,
    input: PUBLIC_TEST_INPUTS["polish-selection"],
    model: "test-model",
    mode: "record" as const,
    recordConsent: true,
  };
  const ids = { taskId: "t", threadId: "th", turnId: "tu" };
  await new HarnessRecorder(directory).record(input, {
    ...ids,
    status: "failed",
    error: { code: "TEST_FAILURE", message: "测试失败。" },
    events: [
      { ...ids, type: "started", atMs: 0 },
      { ...ids, type: "failed", atMs: 1 },
    ],
  });
  h.stale = true;
  await expect(
    new HarnessRecorder(directory).begin(input),
  ).rejects.toMatchObject({ code: "RECORDING_EXISTS" });
  expect(
    (await readdir(directory)).every((name) => name.endsWith(".json")),
  ).toBe(true);
});
