// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import HarnessConsole from "../integrations/codex-harness/console/Console";
const fetchMock = vi.fn();
const status = {
  connected: true,
  authenticated: false,
  authMode: "none",
  browserLoginAvailable: true,
  capabilities: { polishSelection: true, imageGeneration: true },
};
const task = {
  id: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  kind: "polish-selection",
  status: "running",
  model: "test-model",
  mode: "replay",
  events: [],
};
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function reply(value: unknown) {
  return Response.json(value);
}
it("首次配对立即清除URL短码且仅换一次会话，不自动发起Codex登录", async () => {
  history.replaceState(null, "", "/#pair=one-use-code");
  fetchMock
    .mockResolvedValueOnce(reply({ ok: true }))
    .mockResolvedValue(reply(status));
  render(<HarnessConsole />);
  expect(location.hash).toBe("");
  await screen.findByRole("button", { name: "在浏览器登录 Codex" });
  expect(
    fetchMock.mock.calls.filter(([url]) => url === "/v1/pair"),
  ).toHaveLength(1);
  expect(fetchMock.mock.calls[0][1].body).toBe(
    JSON.stringify({ code: "one-use-code" }),
  );
  expect(fetchMock.mock.calls.some(([url]) => url === "/v1/login")).toBe(false);
  expect(
    (
      screen.getByRole("button", {
        name: "回放已录制测试",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("用户点击后获取官方登录链接，重复点击不重入，取消等待", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementation((url: string) =>
    url === "/v1/status"
      ? Promise.resolve(reply(status))
      : url === "/v1/login"
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(reply({ ok: true })),
  );
  render(<HarnessConsole />);
  const login = await screen.findByRole("button", {
    name: "在浏览器登录 Codex",
  });
  fireEvent.click(login);
  fireEvent.click(login);
  expect(
    fetchMock.mock.calls.filter(([url]) => url === "/v1/login"),
  ).toHaveLength(1);
  resolve(
    reply({
      loginId: "l1",
      authUrl: "https://auth.openai.com/authorize?state=fake",
    }),
  );
  const link = await screen.findByRole("link", { name: "打开官方登录页" });
  expect(link.getAttribute("rel")).toContain("noreferrer");
  fireEvent.click(screen.getByRole("button", { name: "取消登录" }));
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "打开官方登录页" })).toBeNull(),
  );
  expect(
    fetchMock.mock.calls.find(([u]) => u === "/v1/login/cancel")?.[1].body,
  ).toBe(JSON.stringify({ loginId: "l1" }));
});
it("非官方登录URL不显示链接或泄漏响应", async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      reply(
        url === "/v1/status"
          ? status
          : { loginId: "l", authUrl: "https://evil.example/token-secret" },
      ),
    ),
  );
  render(<HarnessConsole />);
  fireEvent.click(
    await screen.findByRole("button", { name: "在浏览器登录 Codex" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByRole("link", { name: "打开官方登录页" })).toBeNull();
  expect(document.body.textContent).not.toContain("token-secret");
});
it("已登录白名单任务只提交一次，取消返回终态且不伪造成功", async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      reply(
        url === "/v1/status"
          ? { ...status, authenticated: true }
          : url.endsWith("/cancel")
            ? { ...task, status: "cancelled" }
            : task,
      ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByText("Codex 已登录");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  const submit = screen.getByRole("button", { name: "回放已录制测试" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await screen.findByRole("button", { name: "取消任务" });
  expect(
    fetchMock.mock.calls.filter(
      ([u, init]) => u === "/v1/tasks" && init.method === "POST",
    ),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
  await screen.findByText("任务已取消");
  expect(screen.queryByText("任务已完成")).toBeNull();
});
it("任务恢复查询失败不自动重新提交，结果按纯文本显示", async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      reply(
        url === "/v1/status"
          ? { ...status, authenticated: true }
          : {
              ...task,
              status: "completed",
              result: { text: "<script>bad()</script>" },
            },
      ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByText("Codex 已登录");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  await screen.findByText("<script>bad()</script>");
  expect(document.querySelector("script")).toBeNull();
});
it("网络或非JSON响应错误不回显可能含凭据的底层异常", async () => {
  fetchMock.mockRejectedValue(new Error("transport failed secret-auth-value"));
  render(<HarnessConsole />);
  await screen.findByRole("alert");
  expect(document.body.textContent).not.toContain("secret-auth-value");
  expect(screen.getByRole("alert").textContent).toContain("无法连接");
});
it("轮询确认完成显示结果，不能把running当成功", async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      reply(
        url === "/v1/status"
          ? { ...status, authenticated: true }
          : url === "/v1/tasks"
            ? task
            : { ...task, status: "completed", result: { text: "完成润色" } },
      ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByText("Codex 已登录");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  await screen.findByText("任务处理中");
  expect(screen.queryByText("任务已完成")).toBeNull();
  await screen.findByText("完成润色", {}, { timeout: 2500 });
  expect(fetchMock.mock.calls.filter(([u]) => u === "/v1/tasks")).toHaveLength(
    1,
  );
});
it("轮询网络失败明确反馈，不自动重提任务", async () => {
  fetchMock.mockImplementation((url: string) =>
    url.startsWith("/v1/tasks/")
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(
          reply(
            url === "/v1/status" ? { ...status, authenticated: true } : task,
          ),
        ),
  );
  render(<HarnessConsole />);
  await screen.findByText("Codex 已登录");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  await screen.findByRole("alert", {}, { timeout: 2500 });
  expect(fetchMock.mock.calls.filter(([u]) => u === "/v1/tasks")).toHaveLength(
    1,
  );
  expect(screen.queryByText("任务已完成")).toBeNull();
});
it("提交响应不确定后重试同一输入沿用requestId，避免重复任务", async () => {
  let submissions = 0;
  fetchMock.mockImplementation((url: string) => {
    if (url === "/v1/status")
      return Promise.resolve(reply({ ...status, authenticated: true }));
    submissions++;
    return submissions === 1
      ? Promise.reject(new Error("lost response"))
      : Promise.resolve(reply(task));
  });
  render(<HarnessConsole />);
  await screen.findByText("Codex 已登录");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("处理内容") as HTMLTextAreaElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重试原请求" }));
  await screen.findByText("任务处理中");
  const calls = fetchMock.mock.calls.filter(([u]) => u === "/v1/tasks");
  expect(JSON.parse(calls[0][1].body).requestId).toBe(
    JSON.parse(calls[1][1].body).requestId,
  );
});
it("网页登录失败通知清除失效链接并恢复重试入口", async () => {
  let reads = 0;
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      reply(
        url === "/v1/status"
          ? ++reads === 1
            ? status
            : {
                ...status,
                loginStatus: "failed",
                loginError: "网页登录未完成，请重试。",
              }
          : { loginId: "l1", authUrl: "https://auth.openai.com/authorize" },
      ),
    ),
  );
  render(<HarnessConsole />);
  fireEvent.click(
    await screen.findByRole("button", { name: "在浏览器登录 Codex" }),
  );
  await screen.findByRole("link", { name: "打开官方登录页" });
  await screen.findByText("网页登录未完成，请重试。", {}, { timeout: 2500 });
  expect(screen.queryByRole("link", { name: "打开官方登录页" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "在浏览器登录 Codex" }),
  ).toBeTruthy();
});
it("退出Codex只调用本地账号退出，不触博客身份", async () => {
  let logged = true;
  fetchMock.mockImplementation((url: string) => {
    if (url === "/v1/logout") {
      logged = false;
      return Promise.resolve(reply({ ok: true }));
    }
    return Promise.resolve(reply({ ...status, authenticated: logged }));
  });
  render(<HarnessConsole />);
  fireEvent.click(await screen.findByRole("button", { name: "退出 Codex" }));
  await screen.findByText("Codex 尚未登录");
  expect(fetchMock.mock.calls.some(([u]) => u === "/v1/logout")).toBe(true);
  expect(fetchMock.mock.calls.every(([u]) => u.startsWith("/v1/"))).toBe(true);
});
it("首次状态查询失败后显示未连接而不是永久检查中", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  render(<HarnessConsole />);
  await screen.findByRole("alert");
  expect(screen.getByText("本地服务未连接")).toBeTruthy();
  expect(screen.queryByText("正在检查本地连接…")).toBeNull();
});
it("API key仅在用户点击后发送并立即清空，无持久存储", async () => {
  fetchMock.mockImplementation((u: string) =>
    Promise.resolve(reply(u === "/v1/status" ? status : { ok: true })),
  );
  const storage = vi.spyOn(Storage.prototype, "setItem");
  render(<HarnessConsole />);
  await screen.findByRole("button", { name: "设置 API Key" });
  const field = screen.getByLabelText("API Key") as HTMLInputElement;
  expect(field.type).toBe("password");
  expect(field.autocomplete).toBe("off");
  fireEvent.change(field, { target: { value: "fake-test-key-only" } });
  fireEvent.click(screen.getByRole("button", { name: "设置 API Key" }));
  expect(field.value).toBe("");
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u]) => u === "/v1/auth/api-key")).toBe(
      true,
    ),
  );
  expect(storage).not.toHaveBeenCalled();
  expect(location.href).not.toContain("fake-test-key-only");
  storage.mockRestore();
});
it("无登录也可默认回放，样本只读，未命中不会转真实调用", async () => {
  fetchMock.mockImplementation((u: string) =>
    Promise.resolve(
      u === "/v1/status"
        ? reply({ ...status, connected: false })
        : Response.json(
            { error: { code: "REPLAY_MISS", message: "unsafe upstream" } },
            { status: 404 },
          ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByText("Codex 服务未连接");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  expect(
    (screen.getByLabelText("处理内容") as HTMLTextAreaElement).readOnly,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("没有匹配的录制");
  expect(document.body.textContent).not.toContain("unsafe upstream");
  const calls = fetchMock.mock.calls.filter(([u]) => u === "/v1/tasks");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({
    mode: "replay",
    model: "test-model",
    recordConsent: false,
  });
});
it("真实录制只在专用按钮点击后发起且明确费用，结束后仍默认回放", async () => {
  fetchMock.mockImplementation((u: string) =>
    Promise.resolve(
      reply(
        u === "/v1/status"
          ? { ...status, authenticated: true, authMode: "apiKey" }
          : {
              ...task,
              mode: "record",
              status: "completed",
              result: { text: "ok" },
            },
      ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByText("凭据已设置，尚未验证真实调用");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  expect(screen.getByText(/一个任务可能发起多次模型请求/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([u]) => u === "/v1/tasks")).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "真实运行并录制（可能计费）" }),
  );
  await screen.findByText("任务已完成");
  expect(
    JSON.parse(fetchMock.mock.calls.find(([u]) => u === "/v1/tasks")![1].body),
  ).toMatchObject({ mode: "record", recordConsent: true });
  expect(screen.getByRole("button", { name: "回放已录制测试" })).toBeTruthy();
});
it("API key提交失败也不保留输入或回显凭据", async () => {
  fetchMock.mockImplementation((u: string) =>
    u === "/v1/status"
      ? Promise.resolve(reply(status))
      : Promise.reject(new Error("fake-secret")),
  );
  render(<HarnessConsole />);
  await screen.findByRole("button", { name: "设置 API Key" });
  const field = screen.getByLabelText("API Key") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "fake-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "设置 API Key" }));
  await screen.findByRole("alert");
  expect(field.value).toBe("");
  expect(document.body.textContent).not.toContain("fake-secret");
});
it("展示业务事件顺序和耗时，不将运行中delta当作成功", async () => {
  fetchMock.mockImplementation((u: string) =>
    Promise.resolve(
      reply(
        u === "/v1/status"
          ? status
          : {
              ...task,
              events: [
                { type: "state", status: "running", seq: 0, elapsedMs: 0 },
                {
                  type: "text-delta",
                  text: "流式测试片段",
                  seq: 1,
                  elapsedMs: 25,
                },
              ],
            },
      ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByRole("button", { name: "设置 API Key" });
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  await screen.findByText("流式测试片段");
  expect(screen.getByText(/25 ms/)).toBeTruthy();
  expect(screen.queryByText("任务已完成")).toBeNull();
});
it("真实录制提交不确定时锁住model/kind且仅同ID同record重试", async () => {
  let count = 0;
  fetchMock.mockImplementation((u: string) => {
    if (u === "/v1/status")
      return Promise.resolve(
        reply({ ...status, authenticated: true, authMode: "apiKey" }),
      );
    count++;
    return count === 1
      ? Promise.reject(new Error("network"))
      : Promise.resolve(reply({ ...task, mode: "record" }));
  });
  render(<HarnessConsole />);
  await screen.findByText("凭据已设置，尚未验证真实调用");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "真实运行并录制（可能计费）" }),
  );
  await screen.findByRole("alert");
  expect((screen.getByLabelText("模型 ID") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole("button", { name: "生成图片" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "回放已录制测试" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试原请求" }));
  await screen.findByText("任务处理中");
  const calls = fetchMock.mock.calls
    .filter(([u]) => u === "/v1/tasks")
    .map(([, opts]) => JSON.parse(opts.body));
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[1].mode).toBe("record");
});
it("延迟启动未连接但可网页登录时允许显式打开登录", async () => {
  fetchMock.mockImplementation((u: string) =>
    Promise.resolve(
      reply(
        u === "/v1/status"
          ? { ...status, connected: false }
          : { loginId: "lazy", authUrl: "https://auth.openai.com/authorize" },
      ),
    ),
  );
  render(<HarnessConsole />);
  const button = await screen.findByRole("button", {
    name: "在浏览器登录 Codex",
  });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await screen.findByRole("link", { name: "打开官方登录页" });
});
it.each([
  ["REPLAY_NOT_FOUND", "没有匹配的录制"],
  ["RECORDING_EXISTS", "已有录制"],
  ["RECORDING_PENDING", "未确认的执行记录"],
  ["RECORDING_SENSITIVE", "敏感内容"],
  ["RECORDING_INCOMPLETE", "录制未完成"],
  ["RECORDING_CORRUPT", "完整性校验失败"],
  ["RECORDING_TOO_LARGE", "超过安全大小限制"],
  ["RECORDING_DIRECTORY", "录制目录不可用"],
  ["RECORDING_PROTOCOL", "协议不匹配"],
  ["RECORDING_CONSENT_REQUIRED", "确认可能产生费用"],
])("实际录制错误%s映射准确且不引导重复收费", async (code, phrase) => {
  fetchMock.mockImplementation((u: string) =>
    Promise.resolve(
      u === "/v1/status"
        ? reply(status)
        : Response.json(
            { error: { code, message: "upstream-secret" } },
            { status: 409 },
          ),
    ),
  );
  render(<HarnessConsole />);
  await screen.findByRole("button", { name: "设置 API Key" });
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "test-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "回放已录制测试" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(phrase);
  expect(alert.textContent).not.toContain("upstream-secret");
  expect(fetchMock.mock.calls.filter(([u]) => u === "/v1/tasks")).toHaveLength(
    1,
  );
  expect(screen.queryByRole("button", { name: "重试原请求" })).toBeNull();
});
