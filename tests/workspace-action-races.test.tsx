import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode, type ReactElement } from "react";
import {
  defaultSettings,
  type Post,
  type APIToken,
} from "../src/shared/contracts";
const h = vi.hoisted(() => ({
  values: [] as any[],
  refs: [] as any[],
  i: 0,
  r: 0,
  api: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => {
    const i = h.i++;
    if (!(i in h.values))
      h.values[i] = typeof value === "function" ? (value as Function)() : value;
    return [
      h.values[i],
      (next: any) =>
        (h.values[i] = typeof next === "function" ? next(h.values[i]) : next),
    ];
  },
  useRef: (value: unknown) => (h.refs[h.r++] ??= { current: value }),
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("../src/components/shared/ui", async (original) => ({
  ...(await original<object>()),
  api: h.api,
}));
vi.mock("../src/modules/navigation-performance/use-navigation-ready", () => ({
  useNavigationReady: vi.fn(),
}));
vi.mock("../src/modules/studio-navigation/pane", () => ({
  useStudioPane: () => ({ active: true, navigationKey: 0 }),
}));
import Dashboard from "../src/components/content/Dashboard";
import Integrations from "../src/components/integrations/Integrations";
function nodes(
  node: ReactNode,
  predicate: (props: any) => boolean,
): ReactElement<any>[] {
  if (Array.isArray(node))
    return node.flatMap((child) => nodes(child, predicate));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<any>;
  return [
    ...(predicate(element.props) ? [element] : []),
    ...nodes(element.props.children, predicate),
  ];
}
function render<T>(factory: () => T) {
  h.i = h.r = 0;
  return factory();
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const post = (id: string): Post => ({
  id,
  version: 1,
  title: id,
  slug: id,
  excerpt: "",
  blocks: [],
  category: "",
  tags: [],
  coverImage: "",
  visibility: "draft",
  pinned: false,
  publishedAt: null,
  updatedAt: "2026-10-27T00:00:00Z",
  deletedAt: null,
});
const token = (id: string): APIToken => ({
  id,
  name: id,
  scopes: ["posts:read"],
  createdAt: "2026-10-27T00:00:00Z",
  expiresAt: "2026-11-27T00:00:00Z",
  lastUsedAt: null,
});
const dashboard = () =>
  Dashboard({
    initial: {
      posts: [post("a"), post("b")],
      settings: defaultSettings,
      capabilities: {
        authenticated: true,
        passwordConfigured: false,
        aiConfigured: false,
        imageConfigured: false,
        storageConfigured: true,
        ownerConfigured: true,
      },
    },
  });
const integrations = () =>
  Integrations({
    authenticated: true,
    initialTokens: [token("a"), token("b")],
  });
beforeEach(() => {
  h.values = [];
  h.refs = [];
  h.i = h.r = 0;
  h.api.mockReset();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("文章按钮同一事件帧重复点击只发送一次请求，失败后可以重试", async () => {
  const pending = deferred<any>();
  h.api.mockReturnValue(pending.promise);
  const tree = render(dashboard);
  const click = nodes(tree, (p) => p.title === "置顶文章")[0].props.onClick;
  const first = click();
  const second = click();
  expect(h.api).toHaveBeenCalledTimes(1);
  pending.reject(new Error("失败"));
  await Promise.all([first, second]);
  h.api.mockResolvedValue({ post: { ...post("a"), pinned: true, version: 2 } });
  await nodes(
    render(dashboard),
    (p) => p.title === "置顶文章",
  )[0].props.onClick();
  expect(h.api).toHaveBeenCalledTimes(2);
});
it("跨行请求先完成不会清除另一行的忙碌状态", async () => {
  const a = deferred<any>(),
    b = deferred<any>();
  h.api.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const buttons = nodes(render(dashboard), (p) => p.title === "置顶文章");
  const pa = buttons[0].props.onClick(),
    pb = buttons[1].props.onClick();
  a.resolve({ post: { ...post("a"), pinned: true, version: 2 } });
  await pa;
  const tree = render(dashboard);
  const busyRows = nodes(tree, (p) => p.className === "post-row").filter(
    (row) => nodes(row, (p) => p.title === "置顶文章").length === 0,
  );
  expect(busyRows).toHaveLength(2); // a 已置顶，b 仍显示忙碌占位。
  b.resolve({ post: { ...post("b"), pinned: true, version: 2 } });
  await pb;
});
it("取消回收站操作不发请求", async () => {
  vi.mocked(confirm).mockReturnValue(false);
  await nodes(
    render(dashboard),
    (p) => p.title === "移入回收站",
  )[0].props.onClick();
  expect(h.api).not.toHaveBeenCalled();
});
it("令牌创建重复点击只发一次 POST，创建与撤销不能竞争", async () => {
  render(integrations);
  h.values[3] = true;
  h.values[5] = "测试";
  const tree = render(integrations);
  const create = nodes(tree, (p) => p.children === "创建令牌" && p.onClick)[0]
    .props.onClick;
  const pending = deferred<any>();
  h.api.mockReturnValue(pending.promise);
  const a = create(),
    b = create();
  const c = nodes(tree, (p) => p.title === "撤销令牌")[0].props.onClick();
  expect(h.api).toHaveBeenCalledTimes(1);
  pending.reject(new Error("失败"));
  await Promise.all([a, b, c]);
});
it("并行撤销不会复活已撤销条目，失败后释放锁", async () => {
  const pending = deferred<any>();
  h.api.mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true });
  const buttons = nodes(render(integrations), (p) => p.title === "撤销令牌");
  const first = buttons[0].props.onClick();
  await buttons[1].props.onClick();
  expect(h.api).toHaveBeenCalledTimes(1);
  pending.resolve({ ok: true });
  await first;
  await nodes(
    render(integrations),
    (p) => p.title === "撤销令牌",
  )[0].props.onClick();
  expect(h.values[1]).toEqual([]);
});
it("无效令牌有效期在点击链路中被协议拦截，不发送 POST", async () => {
  render(integrations);
  h.values[3] = true;
  h.values[5] = "测试";
  h.values[7] = 0;
  await nodes(
    render(integrations),
    (p) => p.children === "创建令牌" && p.onClick,
  )[0].props.onClick();
  expect(h.api).not.toHaveBeenCalled();
});
it("创建成功直接使用服务端安全元数据，不因随后 GET 失败让作者重复创建", async () => {
  render(integrations);
  h.values[3] = true;
  h.values[5] = "测试";
  h.api
    .mockResolvedValueOnce({ ...token("c"), token: "mm_" + "c".repeat(64) })
    .mockRejectedValueOnce(new Error("列表网络失败"));
  await nodes(
    render(integrations),
    (p) => p.children === "创建令牌" && p.onClick,
  )[0].props.onClick();
  expect(h.values[3]).toBe(false);
  expect(h.values[1].map((entry: APIToken) => entry.id)).toContain("c");
  expect(h.api).toHaveBeenCalledTimes(1);
  expect(h.values[1].some((entry: any) => "token" in entry)).toBe(false);
});

import SettingsPanel from "../src/components/settings/SettingsPanel";
const settingsPanel = () =>
  SettingsPanel({
    authenticated: true,
    initial: {
      ...defaultSettings,
      providers: ["a", "b"].map((id) => ({
        id,
        name: id,
        kind: "openai" as const,
        model: "text",
        temperature: 0.7,
        maxTokens: 2048,
        configured: true,
      })),
    },
  });
it("模型列表同帧重复读取只发一次，跨服务商完成顺序不清除其他忙碌状态", async () => {
  render(settingsPanel);
  h.values[1] = "models";
  const buttons = nodes(
    render(settingsPanel),
    (p) => p.children === "获取已保存配置的模型列表",
  );
  const a = deferred<any>(),
    b = deferred<any>();
  h.api.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const first = buttons[0].props.onClick(),
    duplicate = buttons[0].props.onClick();
  expect(h.api).toHaveBeenCalledTimes(1);
  const second = buttons[1].props.onClick();
  expect(h.api).toHaveBeenCalledTimes(2);
  a.resolve({ models: [{ id: "a-model" }] });
  await Promise.all([first, duplicate]);
  expect(
    nodes(render(settingsPanel), (p) => p.children === "读取中…"),
  ).toHaveLength(1);
  b.reject(new Error("模型服务失败"));
  await second;
  expect(
    nodes(render(settingsPanel), (p) => p.children === "读取中…"),
  ).toHaveLength(0);
});

it("独立令牌组件初始列表未完成时不能创建或撤销，避免迟到 GET 覆盖写入", async () => {
  const standalone = () => Integrations({ authenticated: true });
  render(standalone);
  h.values[3] = true;
  h.values[5] = "测试";
  const tree = render(standalone);
  const create = nodes(tree, (p) => p.children === "创建令牌" && p.onClick)[0];
  expect(create.props.disabled).toBe(true);
  await create.props.onClick();
  expect(h.api).not.toHaveBeenCalled();
});

it("撤销失败保留条目且释放写入锁，明确重试可以成功", async () => {
  h.api
    .mockRejectedValueOnce(new Error("撤销网络失败"))
    .mockResolvedValueOnce({ revoked: true });
  await nodes(
    render(integrations),
    (p) => p.title === "撤销令牌",
  )[0].props.onClick();
  expect(h.values[1].map((entry: APIToken) => entry.id)).toEqual(["a", "b"]);
  expect(h.values[2]).toBe("撤销网络失败");
  await nodes(
    render(integrations),
    (p) => p.title === "撤销令牌",
  )[0].props.onClick();
  expect(h.values[1].map((entry: APIToken) => entry.id)).toEqual(["b"]);
  expect(h.api).toHaveBeenCalledTimes(2);
});
