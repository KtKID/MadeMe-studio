// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultSettings } from "../../src/shared/contracts";
import { resolveConfig } from "../../src/modules/config";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()), api: h.api,
}));
vi.mock("../../src/modules/navigation-performance/use-navigation-ready", () => ({ useNavigationReady: vi.fn() }));
vi.mock("../../src/modules/studio-navigation/pane", () => ({ useStudioPane: () => ({ active: true, navigationKey: 0 }) }));
import SettingsPanel from "../../src/components/settings/SettingsPanel";

function setup(limits = structuredClone(defaultSettings.limits)) {
  const initial = { ...structuredClone(defaultSettings), navigation: [], prompts: [], providers: [], limits };
  render(<SettingsPanel initial={initial} authenticated onGuardChange={vi.fn()} onSaved={vi.fn()} />);
}
const field = (key: string) =>
  document.querySelector<HTMLInputElement>(`[data-config-field="${key}"] input`)!;
beforeEach(() => { h.api.mockReset(); });
afterEach(() => cleanup());

describe("设置页配置项（真实 DOM）", () => {
  it("四个配置分组可切换，显示默认值与范围", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "上传与媒体" }));
    expect(field("upload.videoMaxMB").value).toBe("25");
    expect(document.querySelector('[data-config-field="upload.videoMaxMB"]')!.textContent).toContain("默认 25 MB，可调 1–50 MB");
    fireEvent.click(screen.getByRole("button", { name: "AI 用量" }));
    expect(field("ai.textPerMinute").value).toBe("20");
    fireEvent.click(screen.getByRole("button", { name: "嵌入与阅读" }));
    expect(field("reading.rssItems").value).toBe("50");
  });
  it("越界值不会保存，显示中文原因", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "上传与媒体" }));
    fireEvent.change(field("upload.videoMaxMB"), { target: { value: "80" } });
    expect(document.querySelector(".config-error")!.textContent).toContain("不能大于 50 MB");
    fireEvent.click(screen.getByRole("button", { name: /保存设置/ }));
    await waitFor(() => expect(document.body.textContent).toContain("无法保存：视频单个文件上限：不能大于 50 MB"));
    expect(h.api).not.toHaveBeenCalled();
  });
  it("合法值只发送改动项；恢复默认发送 null", async () => {
    setup(resolveConfig({ upload: { videoMaxMB: 40 } }));
    fireEvent.click(screen.getByRole("button", { name: "上传与媒体" }));
    fireEvent.change(field("upload.imageMaxMB"), { target: { value: "10" } });
    fireEvent.click(screen.getAllByRole("button", { name: /恢复默认/ })[0]);
    expect(field("upload.videoMaxMB").value).toBe("25");
    expect(field("upload.imageMaxMB").value).toBe("25");
    fireEvent.change(field("upload.imageMaxMB"), { target: { value: "10" } });
    h.api.mockImplementationOnce(async (_url: string, init: RequestInit) => ({
      settings: { ...structuredClone(defaultSettings), navigation: [], prompts: [], providers: [], limits: resolveConfig(JSON.parse(String(init.body)).limits) },
    }));
    fireEvent.click(screen.getByRole("button", { name: /保存设置/ }));
    await waitFor(() => expect(h.api).toHaveBeenCalled());
    expect(JSON.parse(h.api.mock.calls[0][1].body)).toEqual({
      limits: { upload: { videoMaxMB: null, imageMaxMB: 10 } },
    });
  });
  it("部署信息卡片只显示是否已配置", async () => {
    h.api.mockResolvedValueOnce({ deployment: [{ key: "sessionSecret", label: "SESSION_SECRET", configured: true }, { key: "gemini", label: "Gemini 密钥", configured: false }] });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "账号与安全" }));
    await waitFor(() => expect(document.querySelector("[data-deployment-card]")!.textContent).toContain("已配置"));
    expect(h.api).toHaveBeenCalledWith("/api/deployment");
    expect(document.querySelector("[data-deployment-card]")!.textContent).toContain("未配置");
  });
});
