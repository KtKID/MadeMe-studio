import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/shared/contracts";
const harness = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => void | (() => void))[],
  index: 0,
  refIndex: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => {
    const i = harness.index++;
    if (!(i in harness.values)) harness.values[i] = value;
    return [
      harness.values[i],
      (next: unknown) => {
        harness.values[i] =
          typeof next === "function"
            ? (next as Function)(harness.values[i])
            : next;
      },
    ];
  },
  useRef: (value: unknown) => {
    const i = harness.refIndex++;
    return (harness.refs[i] ??= { current: value });
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void | (() => void)) => harness.effects.push(fn),
}));
vi.mock("../src/modules/navigation-performance/browser", () => ({
  installPerformance: vi.fn(),
  manageHistoryPerformance: vi.fn(),
  beginHistoryPerformance: vi.fn(),
  cancelNavigationPerformance: vi.fn(),
}));
import StudioShell from "../src/components/studio/StudioShell";
import {
  cancelNavigationPerformance,
  beginHistoryPerformance,
} from "../src/modules/navigation-performance/browser";
let windowTarget: EventTarget, documentTarget: EventTarget;
let cleanup: (() => void)[];
let go: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
const initial = {
  settings: defaultSettings,
  posts: [],
  initialMedia: [],
  initialTokens: [],
  postsError: "",
  mediaError: "",
  tokensError: "",
  trustedIdentity: "owner",
  capabilities: {
    authenticated: true,
    aiConfigured: false,
    imageConfigured: false,
    passwordConfigured: false,
    storageConfigured: true,
    ownerConfigured: true,
  },
};
function start() {
  harness.index = 0;
  harness.refIndex = 0;
  const tree = StudioShell({ initial, initialPath: "/studio" });
  cleanup = harness.effects
    .map((fn) => fn())
    .filter((fn): fn is () => void => typeof fn === "function");
  return tree;
}
function pop(state: unknown) {
  const event = new Event("popstate");
  Object.assign(event, { state });
  windowTarget.dispatchEvent(event);
}
function pageshow() {
  const event = new Event("pageshow");
  Object.assign(event, { persisted: true });
  windowTarget.dispatchEvent(event);
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  harness.values = [];
  harness.refs = [];
  harness.effects = [];
  harness.index = 0;
  harness.refIndex = 0;
  cleanup = [];
  windowTarget = new EventTarget();
  documentTarget = new EventTarget();
  go = vi.fn();
  fetcher = vi.fn();
  Object.assign(windowTarget, {
    history: { state: {}, replaceState: vi.fn(), pushState: vi.fn(), go },
    confirm: vi.fn(() => true),
    scrollTo: vi.fn(),
  });
  Object.assign(documentTarget, { visibilityState: "visible", title: "" });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("location", {
    href: "https://example.test/studio",
    pathname: "/studio",
    origin: "https://example.test",
    search: "",
    reload: vi.fn(),
  });
});
afterEach(() => {
  cleanup.forEach((fn) => fn());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("pagehide同步取消双帧ready并隐藏；恢复请求强制no-store且等待身份核验", async () => {
  start();
  let finish!: (r: Response) => void;
  fetcher.mockReturnValue(new Promise<Response>((r) => (finish = r)));
  windowTarget.dispatchEvent(new Event("pagehide"));
  expect(harness.values[4]).toBe(false);
  expect(cancelNavigationPerformance).toHaveBeenCalled();
  pageshow();
  expect(fetcher).toHaveBeenCalledWith("/api/identity", {
    credentials: "same-origin",
    cache: "no-store",
  });
  expect(harness.values[4]).toBe(false);
  finish(
    Response.json({
      authenticated: true,
      trustedIdentity: "owner",
      ownerConfigured: true,
    }),
  );
  await flush();
  expect(harness.values[4]).toBe(true);
  expect(harness.values[5]).toBe(true);
});
it("401失效是单调状态，迟到同身份成功响应不能重新显示", async () => {
  start();
  let finish!: (r: Response) => void;
  fetcher.mockReturnValue(new Promise<Response>((r) => (finish = r)));
  pageshow();
  windowTarget.dispatchEvent(new Event("mademe:identity-invalid"));
  finish(
    Response.json({
      authenticated: true,
      trustedIdentity: "owner",
      ownerConfigured: true,
    }),
  );
  await flush();
  expect(harness.values[4]).toBe(false);
  expect(harness.values[5]).toBe(false);
});
it("不同身份卸载私有pane，不保留可恢复旧状态", async () => {
  start();
  fetcher.mockResolvedValue(
    Response.json({
      authenticated: true,
      trustedIdentity: "other",
      ownerConfigured: true,
    }),
  );
  pageshow();
  await flush();
  expect(harness.values[5]).toBe(false);
});
it("history取消只go补偿，补偿事件不产生第二次样本或确认", () => {
  start();
  // 引用只含本document的历史状态，不依赖DOM或私有业务数据。
  const history = harness.refs[3]!
    .current as import("../src/modules/studio-navigation/state").StudioHistory;
  const guard = harness.refs[2]!;
  const active = harness.refs[1]!;
  history.push();
  history.push();
  active.current = "/studio/settings";
  guard.current = { dirty: true, discard: vi.fn() };
  Object.assign(windowTarget, { confirm: vi.fn(() => false) });
  Object.assign(location, { pathname: "/studio" });
  pop({ studio: { session: history.session, index: 0 } });
  expect(go).toHaveBeenCalledWith(2);
  expect(beginHistoryPerformance).toHaveBeenCalledTimes(1);
  Object.assign(location, { pathname: "/studio/settings" });
  pop({ studio: { session: history.session, index: 2 } });
  expect(beginHistoryPerformance).toHaveBeenCalledTimes(1);
  expect(history.locked).toBe(false);
});

it("真实api helper收到401立即通知shell失效，错误JSON迟到也不保留私有界面", async () => {
  start();
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => (finish = resolve));
  fetcher.mockResolvedValue({ status: 401, ok: false, json: () => pending });
  const { api } = await import("../src/components/shared/ui");
  const result = api("/api/tokens").catch((error) => error);
  await flush();
  expect(harness.values[5]).toBe(false);
  expect(harness.values[4]).toBe(false);
  finish({ error: { code: "UNAUTHORIZED", message: "Author required" } });
  expect(await result).toMatchObject({ status: 401 });
});

it("恢复网络错误卸载私有pane，不显示旧数据", async () => {
  start();
  fetcher.mockRejectedValue(new Error("offline"));
  pageshow();
  await flush();
  expect(harness.values[4]).toBe(false);
  expect(harness.values[5]).toBe(false);
});
