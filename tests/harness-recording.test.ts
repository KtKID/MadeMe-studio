import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HarnessRecorder,
  PUBLIC_TEST_INPUTS,
  HARNESS_PROTOCOL_VERSION,
  type RecordingSnapshot,
} from "../integrations/codex-harness/recording";
let dir = "";
afterEach(async () => {
  vi.unstubAllGlobals();
  if (dir) await rm(dir, { recursive: true, force: true });
});
const request = {
  requestId: "10000000-0000-4000-8000-000000000001",
  kind: "polish-selection" as const,
  input: PUBLIC_TEST_INPUTS["polish-selection"],
  model: "test-model",
  mode: "record" as const,
  recordConsent: true,
};
const ids = { taskId: "task-1", threadId: "thread-1", turnId: "turn-1" };
const text = "今天阳光明媚，我们整理书桌，准备开始写作。";
const snapshot = (): RecordingSnapshot => ({
  ...ids,
  status: "completed" as const,
  events: [
    { ...ids, type: "started" as const, atMs: 0 },
    { ...ids, type: "text-delta" as const, atMs: 3, text },
    { ...ids, type: "text-completed" as const, atMs: 4, text },
    { ...ids, type: "completed" as const, atMs: 5 },
  ],
  result: { text },
});
async function setup() {
  dir = await mkdtemp(join(tmpdir(), "harness-recording-"));
  return new HarnessRecorder(dir);
}
it("没有录制不虚构回放；命中只读实盘零网络且不返回旧会话 IDs", async () => {
  const recorder = await setup();
  const network = vi.fn(() => {
    throw Error("network forbidden");
  });
  vi.stubGlobal("fetch", network);
  await expect(recorder.replay(request)).rejects.toMatchObject({
    code: "REPLAY_NOT_FOUND",
  });
  await recorder.record(request, snapshot());
  const replay = await recorder.replay({
    ...request,
    requestId: "20000000-0000-4000-8000-000000000002",
  });
  expect(replay.status).toBe("completed");
  expect(replay.result?.text).toBe(text);
  expect(replay.events.map((e) => e.atMs)).toEqual([0, 3, 4, 5]);
  expect(JSON.stringify(replay)).not.toMatch(/task-1|thread-1|turn-1/);
  expect(network).not.toHaveBeenCalled();
});
it("严格匹配公开样本、模型与协议，失配没有真实请求 fallback", async () => {
  const recorder = await setup();
  await recorder.record(request, snapshot());
  await expect(
    recorder.replay({ ...request, model: "another-model" }),
  ).rejects.toMatchObject({ code: "REPLAY_NOT_FOUND" });
  await expect(
    recorder.replay({ ...request, input: "私人正文" }),
  ).rejects.toMatchObject({ code: "PUBLIC_TEST_ONLY" });
  await expect(
    new HarnessRecorder(dir, HARNESS_PROTOCOL_VERSION + "-other").replay(
      request,
    ),
  ).rejects.toMatchObject({ code: "REPLAY_NOT_FOUND" });
  expect(
    (
      await recorder.replay({
        ...request,
        input: "\n" + request.input + "\r\n",
      })
    ).status,
  ).toBe("completed");
});
it("不记录秘密、鉴权头或个人绝对路径，也不遗留半成品", async () => {
  const recorder = await setup();
  for (const secret of [
    "secret-fixture-value",
    "Authorization: Bearer abcdefghijk",
    "/Users/private/Desktop/note.md",
    "C:\\Users\\private\\note.md",
  ]) {
    const value = snapshot();
    value.result!.text = secret;
    value.events[1].text = secret;
    value.events[2].text = secret;
    await expect(
      recorder.record(request, value, ["secret-fixture-value"]),
    ).rejects.toMatchObject({ code: "RECORDING_SENSITIVE" });
  }
  expect(await readdir(dir)).toEqual([]);
});
it("缺末事件、会话关联错误、无真实图片均拒绝成为 fixture", async () => {
  const recorder = await setup();
  const a = snapshot();
  a.events.pop();
  await expect(recorder.record(request, a)).rejects.toMatchObject({
    code: "RECORDING_INCOMPLETE",
  });
  const b = snapshot();
  b.events[1].turnId = "other";
  await expect(recorder.record(request, b)).rejects.toMatchObject({
    code: "RECORDING_INCOMPLETE",
  });
  await expect(
    recorder.record(
      {
        ...request,
        kind: "image-generation",
        input: PUBLIC_TEST_INPUTS["image-generation"],
      },
      {
        ...ids,
        status: "completed",
        events: [
          { ...ids, type: "started", atMs: 0 },
          { ...ids, type: "image-completed", atMs: 1 },
          { ...ids, type: "completed", atMs: 2 },
        ],
      },
    ),
  ).rejects.toMatchObject({ code: "RECORDING_INCOMPLETE" });
  expect(await readdir(dir)).toEqual([]);
});
it.each(["failed", "cancelled"] as const)(
  "保存 %s 终态且可重放，不假成功",
  async (status) => {
    const recorder = await setup();
    await recorder.record(request, {
      ...ids,
      status,
      events: [
        { ...ids, type: "started", atMs: 0 },
        { ...ids, type: status, atMs: 2 },
      ],
      error: { code: "TASK_STOPPED", message: "公开测试停止。" },
    });
    expect((await recorder.replay(request)).status).toBe(status);
  },
);
it("图片 bytes、MIME 与摘要可重放；文件篡改拒绝", async () => {
  const recorder = await setup();
  const imageRequest = {
    ...request,
    kind: "image-generation" as const,
    input: PUBLIC_TEST_INPUTS["image-generation"],
  };
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  await recorder.record(imageRequest, {
    ...ids,
    status: "completed",
    events: [
      { ...ids, type: "started", atMs: 0 },
      { ...ids, type: "image-completed", atMs: 1 },
      { ...ids, type: "completed", atMs: 2 },
    ],
    artifact: { bytes, mime: "image/png" },
  });
  expect((await recorder.replay(imageRequest)).artifact?.bytes).toEqual(bytes);
  const name = (await readdir(dir))[0];
  const saved = JSON.parse(await readFile(join(dir, name), "utf8"));
  saved.payload.artifact.base64 = "AAAA";
  await writeFile(join(dir, name), JSON.stringify(saved));
  await expect(recorder.replay(imageRequest)).rejects.toMatchObject({
    code: "RECORDING_CORRUPT",
  });
});
it("录制文件无原请求正文、auth/header/绝对路径和会话 IDs", async () => {
  const recorder = await setup();
  await recorder.record(request, snapshot());
  const data = await readFile(join(dir, (await readdir(dir))[0]), "utf8");
  expect(data).not.toContain(request.input);
  expect(data).not.toContain(request.requestId);
  expect(data).not.toContain("thread-1");
  expect(data).toContain("requestHash");
});
it("begin原子防重复付费；已完成或未知执行保留不得开启新真实任务", async () => {
  const recorder = await setup();
  await recorder.begin(request);
  await expect(new HarnessRecorder(dir).begin(request)).rejects.toMatchObject({
    code: "RECORDING_PENDING",
  });
  await recorder.record(request, snapshot());
  await expect(new HarnessRecorder(dir).begin(request)).rejects.toMatchObject({
    code: "RECORDING_EXISTS",
  });
  await expect(
    new HarnessRecorder(dir).begin({
      ...request,
      model: "another",
      recordConsent: false,
    }),
  ).rejects.toMatchObject({ code: "RECORDING_CONSENT_REQUIRED" });
});
it("部分文字delta与最终正文不一致时拒绝；不把不完整stream当成功fixture", async () => {
  const recorder = await setup();
  const value = snapshot();
  value.events[1].text = "缺少后半句";
  await expect(recorder.record(request, value)).rejects.toMatchObject({
    code: "RECORDING_INCOMPLETE",
  });
});
it("图片元数据含会话secret也拒绝持久化", async () => {
  const recorder = await setup();
  const bytes = new Uint8Array(80);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set(Buffer.from("secret-artifact-fixture"), 24);
  await expect(
    recorder.record(
      {
        ...request,
        kind: "image-generation",
        input: PUBLIC_TEST_INPUTS["image-generation"],
      },
      {
        ...ids,
        status: "completed",
        events: [
          { ...ids, type: "started", atMs: 0 },
          { ...ids, type: "image-completed", atMs: 1 },
          { ...ids, type: "completed", atMs: 2 },
        ],
        artifact: { bytes, mime: "image/png" },
      },
      ["secret-artifact-fixture"],
    ),
  ).rejects.toMatchObject({ code: "RECORDING_SENSITIVE" });
  expect(await readdir(dir)).toEqual([]);
});
it("含 JSON 转义字符的秘密也不得落入事件或图片元数据", async () => {
  const recorder = await setup();
  const secret = 'fixture-"secret\\value';
  const value = snapshot();
  value.result!.text = secret;
  value.events[1].text = secret;
  value.events[2].text = secret;
  await expect(recorder.record(request, value, [secret])).rejects.toMatchObject(
    { code: "RECORDING_SENSITIVE" },
  );
  expect(await readdir(dir)).toEqual([]);
});
it("真实请求期间出现陌生同名样本，不覆盖且保留原文件", async () => {
  const recorder = await setup();
  await recorder.begin(request);
  const pending = (await readdir(dir)).find((f) => f.endsWith(".pending"))!;
  const target = join(dir, pending.replace(".pending", ".json"));
  await writeFile(target, "STRANGER RECORDING");
  await expect(recorder.record(request, snapshot())).rejects.toMatchObject({
    code: "RECORDING_EXISTS",
  });
  expect(await readFile(target, "utf8")).toBe("STRANGER RECORDING");
});
it("失败任务里分成两段 delta 的真实秘密也不能落盘", async () => {
  const recorder = await setup();
  const secret = "known-session-secret-fixture";
  await expect(
    recorder.record(
      request,
      {
        ...ids,
        status: "failed",
        error: { code: "TEST_STOPPED", message: "测试停止。" },
        events: [
          { ...ids, type: "started", atMs: 0 },
          { ...ids, type: "text-delta", atMs: 1, text: secret.slice(0, 12) },
          { ...ids, type: "text-delta", atMs: 2, text: secret.slice(12) },
          { ...ids, type: "failed", atMs: 3 },
        ],
      },
      [secret],
    ),
  ).rejects.toMatchObject({ code: "RECORDING_SENSITIVE" });
  expect(await readdir(dir)).toEqual([]);
});
it.each([
  "https://auth.openai.com/authorize?state=test-only-state",
  "https://chatgpt.com/auth/login?code=test-only-code",
])("官方授权链接不能写入公开测试回放：%s", async (url) => {
  const recorder = await setup();
  const value = snapshot();
  value.result!.text = url;
  value.events[1].text = url;
  value.events[2].text = url;
  await expect(recorder.record(request, value)).rejects.toMatchObject({
    code: "RECORDING_SENSITIVE",
  });
  expect(await readdir(dir)).toEqual([]);
});
