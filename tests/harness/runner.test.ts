import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessRunner } from "../../integrations/codex-harness/runner";
class FakeRPC extends EventEmitter {
  calls: { method: string; params: any }[] = [];
  async request(method: string, params?: unknown): Promise<any> {
    this.calls.push({ method, params });
    if (method === "account/read")
      return { account: { type: "chatgpt", email: "private@example.test" } };
    if (method === "account/login/start")
      return {
        type: "chatgpt",
        loginId: "login-1",
        authUrl: "https://auth.openai.com/authorize?state=private",
      };
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    return {};
  }
  close() {}
}
let dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});
async function setup(extras = {}) {
  const root = await mkdtemp(join(tmpdir(), "harness-unit-"));
  dirs.push(root);
  const rpc = new FakeRPC();
  const runner = new HarnessRunner(rpc, {
    workspaceRoot: root,
    browserLoginAvailable: false,
    timeoutMs: 1000,
    ...extras,
  });
  return { runner, rpc, root };
}
async function settle() {
  await new Promise((r) => setTimeout(r, 20));
}
describe("任务与认证的失败关闭", () => {
  it("网页登录默认禁用且不调用login RPC；账户状态不泄email", async () => {
    const { runner, rpc } = await setup();
    await expect(runner.login()).rejects.toMatchObject({
      code: "BROWSER_CALLBACK_UNAVAILABLE",
    });
    expect(rpc.calls).toHaveLength(0);
    expect(await runner.status()).toEqual({
      connected: true,
      authenticated: true,
      browserLoginAvailable: false,
      capabilities: { polishSelection: true, imageGeneration: true },
      loginStatus: "idle",
    });
  });
  it("显式同机模式只调用chatgpt网页登录", async () => {
    const { runner, rpc } = await setup({ browserLoginAvailable: true });
    await runner.login();
    expect(rpc.calls[0]).toEqual({
      method: "account/login/start",
      params: { type: "chatgpt" },
    });
  });
  it("同requestId重试复用任务，文本只在真实完成后交付", async () => {
    const { runner, rpc } = await setup();
    const input = {
      requestId: crypto.randomUUID(),
      kind: "polish-selection" as const,
      input: "原文",
    };
    const a = await runner.create(input);
    expect(await runner.create(input)).toEqual(a);
    await settle();
    rpc.emit("notification", {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", text: "润色正文" },
      },
    });
    expect(runner.get(a.id).status).toBe("running");
    rpc.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    });
    await settle();
    expect(runner.get(a.id)).toMatchObject({
      status: "completed",
      result: { text: "润色正文" },
    });
    expect(rpc.calls.filter((x) => x.method === "turn/start")).toHaveLength(1);
    runner.close();
  });
  it("同requestId不同输入拒绝；未认证不启动任务", async () => {
    const { runner } = await setup();
    const input = {
      requestId: crypto.randomUUID(),
      kind: "polish-selection" as const,
      input: "原文",
    };
    await runner.create(input);
    await expect(
      runner.create({ ...input, input: "另一个" }),
    ).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    runner.close();
    const fresh = await setup();
    fresh.rpc.request = async () => ({ account: null });
    await expect(
      fresh.runner.create({ ...input, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    fresh.runner.close();
  });
  it("取消后迟到完成不能变成功，进程关闭不重试", async () => {
    const { runner, rpc } = await setup();
    const task = await runner.create({
      requestId: crypto.randomUUID(),
      kind: "polish-selection",
      input: "a",
    });
    await settle();
    await runner.cancel(task.id);
    rpc.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    });
    await settle();
    expect(runner.get(task.id).status).toBe("cancelled");
    expect(rpc.calls.some((x) => x.method === "turn/interrupt")).toBe(true);
    runner.close();
  });
  it("审批不会自动放行；任务明确失败", async () => {
    const { runner, rpc } = await setup();
    const task = await runner.create({
      requestId: crypto.randomUUID(),
      kind: "polish-selection",
      input: "a",
    });
    await settle();
    rpc.emit("approval", { method: "item/commandExecution/requestApproval" });
    expect(runner.get(task.id)).toMatchObject({
      status: "failed",
      error: { code: "APPROVAL_REQUIRED" },
    });
    runner.close();
  });
  it("只有文本冒充生图必须失败", async () => {
    const { runner, rpc } = await setup();
    const task = await runner.create({
      requestId: crypto.randomUUID(),
      kind: "image-generation",
      input: "云",
    });
    await settle();
    rpc.emit("notification", {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", text: "图片生成成功" },
      },
    });
    rpc.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    });
    await settle();
    expect(runner.get(task.id)).toMatchObject({
      status: "failed",
      error: { code: "IMAGE_RESULT_UNAVAILABLE" },
    });
    runner.close();
  });
});
it("并发网页登录只发一个start，失败通知允许重新登录且不泄上游内容", async () => {
  const { runner, rpc } = await setup({ browserLoginAvailable: true });
  let finish!: (v: any) => void;
  rpc.request = async (method) =>
    method === "account/login/start"
      ? await new Promise((r) => {
          finish = r;
        })
      : { account: null };
  const first = runner.login();
  await expect(runner.login()).rejects.toMatchObject({ code: "LOGIN_PENDING" });
  finish({
    type: "chatgpt",
    loginId: "login-1",
    authUrl: "https://auth.openai.com/authorize",
  });
  await first;
  rpc.emit("notification", {
    method: "account/login/completed",
    params: { loginId: "login-1", success: false, error: "secret raw error" },
  });
  expect(await runner.status()).toMatchObject({
    loginStatus: "failed",
    loginError: "网页登录未完成，请重试。",
  });
  runner.close();
});
it("turn启动结果不确定时关闭专用进程，禁止同进程继续任务", async () => {
  const { runner, rpc } = await setup();
  const original = rpc.request.bind(rpc);
  let closed = false;
  rpc.close = () => {
    closed = true;
  };
  rpc.request = async (method, params) => {
    if (method === "turn/start") throw new Error("response lost");
    return original(method, params);
  };
  const task = await runner.create({
    requestId: crypto.randomUUID(),
    kind: "polish-selection",
    input: "a",
  });
  await settle();
  expect(closed).toBe(true);
  expect((await runner.status()).connected).toBe(false);
  expect(runner.get(task.id).status).toBe("failed");
  await expect(
    runner.create({
      requestId: crypto.randomUUID(),
      kind: "polish-selection",
      input: "b",
    }),
  ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
});
it("turn/start尚未返回时取消立即关闭专用进程，不等待RPC超时", async () => {
  const { runner, rpc } = await setup();
  const original = rpc.request.bind(rpc);
  let closed = false;
  rpc.close = () => {
    closed = true;
  };
  rpc.request = async (method, params) =>
    method === "turn/start" ? new Promise(() => {}) : original(method, params);
  const task = await runner.create({
    requestId: crypto.randomUUID(),
    kind: "polish-selection",
    input: "a",
  });
  await settle();
  await runner.cancel(task.id);
  expect(closed).toBe(true);
  expect((await runner.status()).connected).toBe(false);
});
it("interrupt失败后断开，不继续接受任务", async () => {
  const { runner, rpc } = await setup();
  const original = rpc.request.bind(rpc);
  let closed = false;
  rpc.close = () => {
    closed = true;
  };
  rpc.request = async (method, params) => {
    if (method === "turn/interrupt") throw Error("lost");
    return original(method, params);
  };
  const task = await runner.create({
    requestId: crypto.randomUUID(),
    kind: "polish-selection",
    input: "a",
  });
  await settle();
  await runner.cancel(task.id).catch(() => {});
  expect(closed).toBe(true);
  expect((await runner.status()).connected).toBe(false);
});
it("登录RPC返回不安全URL后关闭进程，不留下未知登录继续重试", async () => {
  const { runner, rpc } = await setup({ browserLoginAvailable: true });
  let closed = false;
  rpc.close = () => {
    closed = true;
  };
  rpc.request = async () => ({
    loginId: "l",
    authUrl: "https://evil.test/auth",
  });
  await expect(runner.login()).rejects.toMatchObject({
    code: "UNSAFE_LOGIN_URL",
  });
  expect(closed).toBe(true);
});
it("实际临时图片文件经完成事件交付不透明artifact，不泄露磁盘路径", async () => {
  const { runner, rpc, root } = await setup();
  const task = await runner.create({
    requestId: crypto.randomUUID(),
    kind: "image-generation",
    input: "蓝天",
  });
  await settle();
  const savedPath = join(root, task.id, "artifacts", "图.png");
  await writeFile(
    savedPath,
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(24).fill(0)]),
  );
  rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { type: "imageGeneration", status: "completed", savedPath },
    },
  });
  rpc.emit("notification", {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed" },
    },
  });
  await settle();
  const result = runner.get(task.id);
  expect(result.status).toBe("completed");
  expect(result.result?.artifactId).toBeTruthy();
  expect(runner.artifact(result.result!.artifactId!).mime).toBe("image/png");
  expect(JSON.stringify(result)).not.toContain(root);
  runner.close();
});
it("thread审批路由显式用户且不启用自动批准", async () => {
  const { runner, rpc } = await setup();
  await runner.create({
    requestId: crypto.randomUUID(),
    kind: "polish-selection",
    input: "原文",
  });
  await settle();
  expect(
    rpc.calls.find((c) => c.method === "thread/start")?.params,
  ).toMatchObject({
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "read-only",
  });
  runner.close();
});
