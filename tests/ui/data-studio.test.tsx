// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const apiMock = vi.fn();
vi.mock("../../src/components/shared/ui", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/components/shared/ui")>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock(
  "../../src/modules/navigation-performance/use-navigation-ready",
  () => ({
    useNavigationReady: () => {},
  }),
);
import DataStudio from "../../src/components/studio/DataStudio";

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const summary = { visits: 7, visitors: 3 };
const visitors = {
  items: [
    { ip: "203.0.113.7", views: 5, lastTs: 1735689600123, country: "CN" },
    { ip: null, views: 2, lastTs: 1735689000000, country: null },
  ],
  total: 2,
  page: 1,
  pageSize: 10,
  totalPages: 1,
};

function mockOk() {
  apiMock.mockImplementation((url: string) =>
    url.includes("/views/summary")
      ? Promise.resolve(summary)
      : Promise.resolve(visitors),
  );
}

it("网站状态：渲染访客数、访问次数与 IP 列表，公开页以外唯一展示处", async () => {
  mockOk();
  render(<DataStudio />);
  expect(await screen.findByText("203.0.113.7")).toBeTruthy();
  expect(screen.getByText("未知")).toBeTruthy(); // 无 IP 的访问归入「未知」
  expect(screen.getByText("访客数（去重 IP）")).toBeTruthy();
  expect(screen.getAllByText("访问次数").length).toBeGreaterThanOrEqual(2); // 统计卡 + 表头
  expect(screen.getByText("7")).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /上一页/ })).toBeNull(); // 单页不显示分页
  const tab = screen.getByRole("tab", { name: "网站状态" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
});

it("分页：点击下一页携带 page=2 重新请求并渲染新页", async () => {
  apiMock.mockImplementation((url: string) =>
    url.includes("/views/summary")
      ? Promise.resolve(summary)
      : Promise.resolve({
          ...visitors,
          items: [
            {
              ip: "203.0.113.7",
              views: 5,
              lastTs: 1735689600123,
              country: "CN",
            },
          ],
          total: 12,
          page: 1,
          totalPages: 2,
        }),
  );
  render(<DataStudio />);
  await screen.findByText("203.0.113.7");
  apiMock.mockImplementation((url: string) =>
    url.includes("/views/summary")
      ? Promise.resolve(summary)
      : Promise.resolve({
          ...visitors,
          items: [
            {
              ip: "198.51.100.9",
              views: 1,
              lastTs: 1735688000000,
              country: "JP",
            },
          ],
          total: 12,
          page: 2,
          totalPages: 2,
        }),
  );
  fireEvent.click(screen.getByRole("button", { name: /下一页/ }));
  expect(
    apiMock.mock.calls.some(([url]) => String(url).includes("page=2")),
  ).toBe(true);
  expect(await screen.findByText("198.51.100.9")).toBeTruthy();
  expect(screen.getByRole("button", { name: /上一页/ })).toBeTruthy();
});

it("加载失败显示错误提示而不是数字", async () => {
  apiMock.mockRejectedValue(new Error("Owner sign-in is required."));
  render(<DataStudio />);
  expect(await screen.findByText("Owner sign-in is required.")).toBeTruthy();
  expect(screen.queryByText("访客数（去重 IP）")).toBeNull();
});
