import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    state.effects.push(effect);
  },
}));
vi.mock("../src/modules/navigation-performance/use-navigation-ready", () => ({
  useNavigationReady: vi.fn(),
}));
import MediaLibrary from "../src/components/media/MediaLibrary";
import Integrations from "../src/components/integrations/Integrations";
import { useNavigationReady } from "../src/modules/navigation-performance/use-navigation-ready";
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.effects = [];
  fetcher = vi.fn().mockResolvedValue(Response.json({ media: [] }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("location", { origin: "http://localhost" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("SSR 空媒体列表代表已经加载，挂载后不再 GET；弹窗 undefined 保留 GET", async () => {
  renderToStaticMarkup(<MediaLibrary initialMedia={[]} />);
  state.effects.forEach((effect) => effect());
  expect(fetcher).not.toHaveBeenCalled();
  expect(useNavigationReady).toHaveBeenLastCalledWith(
    "/studio/media",
    true,
    false,
  );
  state.effects = [];
  renderToStaticMarkup(<MediaLibrary />);
  state.effects.forEach((effect) => effect());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(useNavigationReady).toHaveBeenLastCalledWith(
    "/studio/media",
    false,
    false,
  );
});
it("SSR 媒体加载错误上报 failed，不补请求伪装 ready", () => {
  const html = renderToStaticMarkup(
    <MediaLibrary initialMedia={[]} initialError="加载失败" />,
  );
  state.effects.forEach((effect) => effect());
  expect(html).toContain("加载失败");
  expect(fetcher).not.toHaveBeenCalled();
  expect(useNavigationReady).toHaveBeenLastCalledWith(
    "/studio/media",
    true,
    true,
  );
});
it("SSR 安全令牌列表挂载不再 GET；加载错误明确 failed", () => {
  renderToStaticMarkup(<Integrations authenticated initialTokens={[]} />);
  state.effects.forEach((effect) => effect());
  expect(fetcher).not.toHaveBeenCalled();
  expect(useNavigationReady).toHaveBeenLastCalledWith(
    "/studio/integrations",
    true,
    false,
  );
  renderToStaticMarkup(
    <Integrations authenticated initialTokens={[]} initialError="加载失败" />,
  );
  expect(useNavigationReady).toHaveBeenLastCalledWith(
    "/studio/integrations",
    true,
    true,
  );
});
