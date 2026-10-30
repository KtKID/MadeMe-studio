import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessRunner } from "../../integrations/codex-harness/runner";
import {
  HarnessRecorder,
  PUBLIC_TEST_INPUTS,
} from "../../integrations/codex-harness/recording";
class RPC extends EventEmitter {
  calls: { method: string; params: any }[] = [];
  close() {}
  async request(method: string, params?: unknown): Promise<any> {
    this.calls.push({ method, params });
    if (method === "config/read")
      return { config: { cli_auth_credentials_store: "ephemeral" } };
    if (method === "account/login/start") return { type: "apiKey" };
    if (method === "thread/start") return { thread: { id: "thread" } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    return {};
  }
}
const dirs: string[] = [];
const runners: HarnessRunner[] = [];
afterEach(async () => {
  for (const r of runners) r.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs.length = 0;
  runners.length = 0;
});
const input = () => ({
  requestId: crypto.randomUUID(),
  kind: "polish-selection" as const,
  input: PUBLIC_TEST_INPUTS["polish-selection"],
  model: "fixture-model",
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-record-"));
  dirs.push(root);
  const recorder = new HarnessRecorder(join(root, "recordings"));
  const rpc = new RPC();
  const factory = vi.fn(async () => rpc);
  const runner = new HarnessRunner(factory, {
    workspaceRoot: root,
    recorder,
    browserLoginAvailable: true,
  });
  runners.push(runner);
  return { runner, rpc, root, recorder, factory };
}
it("默认回放及status绝不启动AppServer或网络，缺录制明确失败不回退", async () => {
  const { runner, factory } = await fixture();
  expect(await runner.status()).toMatchObject({
    connected: false,
    authenticated: false,
    authMode: "none",
  });
  const task = await runner.create(input());
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("failed"));
  expect(runner.get(task.id)).toMatchObject({
    mode: "replay",
    status: "failed",
    error: { code: "REPLAY_NOT_FOUND" },
  });
  expect(factory).not.toHaveBeenCalled();
});
it("真实录制无key拒绝且不自动启动；私文不能记录", async () => {
  const { runner, factory } = await fixture();
  await expect(
    runner.create({ ...input(), mode: "record", recordConsent: true }),
  ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  await expect(
    runner.create({
      ...input(),
      mode: "record",
      recordConsent: true,
      input: "私密正文",
    }),
  ).rejects.toMatchObject({ code: "PUBLIC_SAMPLE_REQUIRED" });
  expect(factory).not.toHaveBeenCalled();
});
it("key仅专用RPC设置、配置必须证明ephemeral、状态不回显key；logout清身份", async () => {
  const { runner, rpc } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  expect(rpc.calls.map((c) => c.method)).toEqual([
    "config/read",
    "account/login/start",
  ]);
  expect(rpc.calls[1].params).toEqual({
    type: "apiKey",
    apiKey: "sk-fixture-only",
  });
  expect(await runner.status()).toMatchObject({
    authMode: "apiKey",
    authenticated: true,
  });
  expect(JSON.stringify(await runner.status())).not.toContain(
    "sk-fixture-only",
  );
  await runner.logout();
  expect((await runner.status()).authMode).toBe("none");
});
it("effective credentials store不明时不把key发送给AppServer", async () => {
  const { runner, rpc } = await fixture();
  rpc.request = async (method) => {
    rpc.calls.push({ method, params: {} });
    return { config: { cli_auth_credentials_store: "file" } };
  };
  await expect(
    runner.setApiKey({ apiKey: "sk-fixture-only" }),
  ).rejects.toMatchObject({ code: "EPHEMERAL_AUTH_UNVERIFIED" });
  expect(rpc.calls.map((c) => c.method)).toEqual(["config/read"]);
});
it("fake真实任务录制delta/结果再离线回放，model进入RPC；同requestId不重复执行", async () => {
  const { runner, rpc, root, recorder } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  const request = { ...input(), mode: "record", recordConsent: true };
  const task = await runner.create(request);
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  expect(rpc.calls.find((c) => c.method === "thread/start")?.params.model).toBe(
    "fixture-model",
  );
  rpc.emit("notification", {
    method: "item/agentMessage/delta",
    params: { threadId: "thread", turnId: "turn", delta: "润色完成" },
  });
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { type: "agentMessage", text: "润色完成" },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("completed"));
  expect(runner.get(task.id)).toMatchObject({
    status: "completed",
    result: { text: "润色完成" },
  });
  expect(await runner.create(request)).toMatchObject({ id: task.id });
  expect(rpc.calls.filter((c) => c.method === "turn/start")).toHaveLength(1);
  const failFactory = vi.fn(async () => {
    throw Error("must not start");
  });
  const replay = new HarnessRunner(failFactory, {
    workspaceRoot: root,
    browserLoginAvailable: true,
    recorder,
  });
  runners.push(replay);
  const again = await replay.create(input());
  await vi.waitFor(() => expect(replay.get(again.id).status).toBe("completed"));
  expect(replay.get(again.id)).toMatchObject({
    status: "completed",
    mode: "replay",
    result: { text: "润色完成" },
  });
  expect(failFactory).not.toHaveBeenCalled();
  expect(
    (await readdir(join(root, "recordings"))).some((f) => f.endsWith(".json")),
  ).toBe(true);
});
it("上游echo虚构key的delta/最终文字不能进入对外任务或录制", async () => {
  const { runner, rpc } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  const task = await runner.create({
    ...input(),
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  await Promise.resolve();
  rpc.emit("notification", {
    method: "item/agentMessage/delta",
    params: { threadId: "thread", turnId: "turn", delta: "sk-fixture-only" },
  });
  expect(JSON.stringify(runner.get(task.id))).not.toContain("sk-fixture-only");
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { type: "agentMessage", text: "sk-fixture-only" },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("failed"));
  expect(JSON.stringify(runner.get(task.id))).not.toContain("sk-fixture-only");
});
it("录制尚未落盘不能暴露completed/result", async () => {
  const { runner, rpc, recorder } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  let finish!: () => void;
  recorder.record = async () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const task = await runner.create({
    ...input(),
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  await Promise.resolve();
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { type: "agentMessage", text: "安全结果" },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
  expect(runner.get(task.id).status).toBe("running");
  expect(runner.get(task.id).result).toBeUndefined();
  finish();
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("completed"));
});
it("取消真实fake任务会录制安全取消终态，默认回放不重发请求", async () => {
  const { runner, rpc, recorder, root } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  const task = await runner.create({
    ...input(),
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  expect((await runner.cancel(task.id)).status).toBe("cancelled");
  const off = vi.fn(async () => {
    throw Error("must not start");
  });
  const replay = new HarnessRunner(off, { workspaceRoot: root, recorder });
  runners.push(replay);
  const task2 = await replay.create(input());
  await vi.waitFor(() => expect(replay.get(task2.id).status).toBe("cancelled"));
  expect(off).not.toHaveBeenCalled();
});
it("早到错turn和缺turnID通知不得进入最终录制", async () => {
  const { runner, rpc } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  const old = rpc.request.bind(rpc);
  let release!: (value: unknown) => void;
  rpc.request = async (method, params) =>
    method === "turn/start"
      ? await new Promise((resolve) => {
          release = resolve;
        })
      : old(method, params);
  const task = await runner.create({
    ...input(),
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() => expect(release).toBeDefined());
  rpc.emit("notification", {
    method: "item/agentMessage/delta",
    params: { threadId: "thread", turnId: "wrong-turn", delta: "wrong" },
  });
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      item: { type: "agentMessage", text: "missing id" },
    },
  });
  release({ turn: { id: "turn" } });
  await vi.waitFor(() =>
    expect((runner as any).tasks.get(task.id).turnId).toBe("turn"),
  );
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { type: "agentMessage", text: "正确结果" },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("completed"));
  expect(JSON.stringify(runner.get(task.id))).not.toMatch(/wrong|missing id/);
  expect(runner.get(task.id).result?.text).toBe("正确结果");
});
it("录制等待期间迟到delta不可混入已校验发布内容，取消不能改写录制终态", async () => {
  const { runner, rpc, recorder } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  let finish!: () => void;
  recorder.record = async () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const task = await runner.create({
    ...input(),
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { type: "agentMessage", text: "安全结果" },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
  rpc.emit("notification", {
    method: "item/agentMessage/delta",
    params: { threadId: "thread", turnId: "turn", delta: "sk-fixture-only" },
  });
  await expect(runner.cancel(task.id)).rejects.toMatchObject({
    code: "RECORDING_PENDING",
  });
  finish();
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("completed"));
  expect(JSON.stringify(runner.get(task.id))).not.toContain("sk-fixture-only");
});
it("图片产物含虚构key时录制拒绝，不发布artifactId或留下可读取图片", async () => {
  const { runner, rpc } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  const task = await runner.create({
    ...input(),
    kind: "image-generation",
    input: PUBLIC_TEST_INPUTS["image-generation"],
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(24).fill(0)]),
    Buffer.from("sk-fixture-only"),
  ]);
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: {
        type: "imageGeneration",
        status: "completed",
        result: bytes.toString("base64"),
      },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
  expect(runner.get(task.id).result).toBeUndefined();
  await vi.waitFor(() => expect(runner.get(task.id).status).toBe("failed"));
  expect(runner.get(task.id).result).toBeUndefined();
  expect((runner as any).artifacts.size).toBe(0);
});
it("运行或保存录制期间不能用网页登录切换认证", async () => {
  const { runner, rpc } = await fixture();
  await runner.setApiKey({ apiKey: "sk-fixture-only" });
  const task = await runner.create({
    ...input(),
    mode: "record",
    recordConsent: true,
  });
  await vi.waitFor(() =>
    expect(rpc.calls.find((c) => c.method === "turn/start")).toBeDefined(),
  );
  await expect(runner.login()).rejects.toMatchObject({ code: "TASK_BUSY" });
  await runner.cancel(task.id);
});
it("回放图片同样最多保留5项，第6次失败且不启动真实进程", async () => {
  const { runner, recorder, factory } = await fixture();
  recorder.replay = async () => ({
    status: "completed",
    events: [
      { type: "started", atMs: 0 },
      { type: "image-completed", atMs: 1 },
      { type: "completed", atMs: 2 },
    ],
    artifact: {
      bytes: new Uint8Array([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        ...new Array(24).fill(0),
      ]),
      mime: "image/png",
    },
  });
  for (let i = 0; i < 5; i++) {
    const task = await runner.create({
      ...input(),
      kind: "image-generation",
      input: PUBLIC_TEST_INPUTS["image-generation"],
    });
    await vi.waitFor(() =>
      expect(runner.get(task.id).status).toBe("completed"),
    );
  }
  const last = await runner.create({
    ...input(),
    kind: "image-generation",
    input: PUBLIC_TEST_INPUTS["image-generation"],
  });
  await vi.waitFor(() => expect(runner.get(last.id).status).not.toBe("queued"));
  expect(runner.get(last.id)).toMatchObject({
    status: "failed",
    error: { code: "ARTIFACT_LIMIT" },
  });
  expect((runner as any).artifacts.size).toBe(5);
  expect(factory).not.toHaveBeenCalled();
});
