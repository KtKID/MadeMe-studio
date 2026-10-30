// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SettingsPanel from "../../src/components/settings/SettingsPanel";
import { defaultSettings } from "../../src/shared/contracts";
vi.mock(
  "../../src/modules/navigation-performance/use-navigation-ready",
  () => ({ useNavigationReady: () => true }),
);
afterEach(cleanup);
it("云端模型设置展示独立本地 harness 边界，不提供不可完成的 OAuth 登录或扫描 localhost", () => {
  const request = vi.spyOn(globalThis, "fetch");
  render(
    <SettingsPanel
      initial={structuredClone(defaultSettings)}
      authenticated={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 模型" }));
  expect(
    screen.getByRole("heading", { name: "Codex 本地 Harness" }),
  ).toBeTruthy();
  expect(screen.getByText(/云端博客尚未配对本地运行器/)).toBeTruthy();
  expect(screen.getByText(/同一台电脑/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /登录 Codex/ })).toBeNull();
  expect(request).not.toHaveBeenCalled();
  request.mockRestore();
});
