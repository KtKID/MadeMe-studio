import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode, type ReactElement } from "react";
const h = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => unknown)[],
  i: 0,
  r: 0,
  active: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => {
    const i = h.i++;
    if (!(i in h.values)) h.values[i] = value;
    return [
      h.values[i],
      (next: unknown) =>
        (h.values[i] =
          typeof next === "function" ? (next as Function)(h.values[i]) : next),
    ];
  },
  useRef: (value: unknown) => (h.refs[h.r++] ??= { current: value }),
  useEffect: (fn: () => unknown) => h.effects.push(fn),
}));
vi.mock("../src/modules/studio-navigation/pane", () => ({
  useStudioPane: () => ({ active: h.active, navigationKey: 0 }),
}));
vi.mock("../src/modules/navigation-performance/use-navigation-ready", () => ({
  useNavigationReady: vi.fn(),
}));
import Integrations from "../src/components/integrations/Integrations";
function render() {
  h.i = 0;
  h.r = 0;
  h.effects = [];
  const tree = Integrations({ authenticated: true, initialTokens: [] });
  h.effects.forEach((effect) => effect());
  return tree;
}
function findCreate(node: ReactNode): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCreate(child);
      if (found) return found;
    }
  }
  if (isValidElement(node)) {
    const element = node as ReactElement<{
      children?: ReactNode;
      onClick?: () => Promise<void>;
    }>;
    if (
      element.type === "button" &&
      element.props.children === "创建令牌" &&
      element.props.onClick
    )
      return element.props.onClick;
    return findCreate(element.props.children);
  }
}
beforeEach(() => {
  h.values = [];
  h.refs = [];
  h.effects = [];
  h.i = 0;
  h.r = 0;
  h.active = true;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", { origin: "http://localhost" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("离开或pagehide清空已展示secret与modal", () => {
  render();
  h.values[3] = true;
  h.values[4] = "private-once";
  h.active = false;
  render();
  expect(h.values[3]).toBe(false);
  expect(h.values[4]).toBe("");
  h.active = true;
  render();
  h.values[4] = "private-again";
  window.dispatchEvent(new Event("mademe:private-conceal"));
  expect(h.values[4]).toBe("");
});
it("POST迟到于离开及返回，列表更新但一次性secret不可复活", async () => {
  render();
  h.values[3] = true;
  h.values[5] = "测试";
  const create = findCreate(render());
  expect(create).toBeDefined();
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(Response.json({ tokens: [] })),
  );
  const pending = create!();
  h.active = false;
  render();
  h.active = true;
  render();
  finish(
    Response.json({
      id: "fixture",
      name: "测试",
      scopes: ["posts:read"],
      createdAt: "2026-10-27T00:00:00Z",
      expiresAt: "2026-11-27T00:00:00Z",
      lastUsedAt: null,
      token: "mm_" + "a".repeat(64),
    }),
  );
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(h.values[2]).toBe("");
  expect(h.values[4]).toBe("");
});
