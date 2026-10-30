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
  browserLoginAvailable: true,
  capabilities: { polishSelection: true, imageGeneration: true },
};
const task = {
  id: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  kind: "polish-selection",
  status: "running",
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
    (screen.getByRole("button", { name: "提交任务" }) as HTMLButtonElement)
      .disabled,
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
  fireEvent.change(screen.getByLabelText("处理内容"), {
    target: { value: "hello" },
  });
  const submit = screen.getByRole("button", { name: "提交任务" });
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
  fireEvent.change(screen.getByLabelText("处理内容"), {
    target: { value: "hello" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交任务" }));
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
  fireEvent.change(screen.getByLabelText("处理内容"), {
    target: { value: "hello" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交任务" }));
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
  fireEvent.change(screen.getByLabelText("处理内容"), {
    target: { value: "hello" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交任务" }));
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
  fireEvent.change(screen.getByLabelText("处理内容"), {
    target: { value: "hello" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交任务" }));
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
