// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultSettings, type Settings } from "../../src/shared/contracts";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/components/shared/ui", async (original) => ({
  ...(await original<object>()), api: h.api,
}));
vi.mock("../../src/modules/navigation-performance/use-navigation-ready", () => ({ useNavigationReady: vi.fn() }));
vi.mock("../../src/modules/studio-navigation/pane", () => ({ useStudioPane: () => ({ active: true, navigationKey: 0 }) }));
import { renderToString } from "react-dom/server";
import SettingsPanel from "../../src/components/settings/SettingsPanel";

// 真实组件与 DOM 交互；仅 API 被替换，绝不写生产设置。
function setup(extra: Partial<Settings> = {}) {
  const initial = { ...structuredClone(defaultSettings), navigation: [], prompts: [], providers: [], ...extra };
  const guard = vi.fn();
  const saved = vi.fn();
  render(<SettingsPanel initial={initial} authenticated onGuardChange={guard} onSaved={saved} />);
  return { initial, guard, saved };
}
function click(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
function input(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
beforeEach(() => { h.api.mockReset(); window.history.replaceState({}, "", "/"); });
afterEach(() => {
  cleanup();
  for (const key of ["theme", "mode", "skin", "font"]) delete document.documentElement.dataset[key];
  document.documentElement.style.removeProperty("--accent");
});
describe("设置真实 DOM 点击链路", () => {
  it("五个分类正确切换，切换本身不请求或保存", () => {
    setup();
    expect(screen.getByLabelText("站点名称")).toBeTruthy();
    click("主题与字体"); expect(screen.getByLabelText("正文字体")).toBeTruthy();
    expect(screen.queryByLabelText("站点名称")).toBeNull();
    click("AI 模型"); expect(screen.getByRole("button", { name: "添加模型" })).toBeTruthy();
    click("提示词"); expect(screen.getByRole("button", { name: "添加提示词" })).toBeTruthy();
    click("自定义代码"); expect(screen.getByLabelText("HTML / CSS 片段")).toBeTruthy();
    click("站点信息"); expect(screen.getByLabelText("站点名称")).toBeTruthy();
    expect(h.api).not.toHaveBeenCalled();
  });
  it("添加导航、拒绝脚本 URL、移除后恢复干净状态", async () => {
    const { guard } = setup();
    click("添加链接"); input("导航 1 名称", "我的链接"); input("导航 1 地址", "javascript:alert(1)");
    click("保存设置");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(h.api).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("我的链接")).toBeTruthy();
    click("移除此链接");
    expect(screen.queryByLabelText("导航 1 地址")).toBeNull();
    expect(guard.mock.lastCall?.[0].dirty).toBe(false);
  });
  it("模型列表失败可重试，重复点击只读取一次，成功填入候选项", async () => {
    setup({ providers: [{ id: "model_test", name: "测试模型", kind: "openai", model: "test", temperature: 0.7, maxTokens: 2048, configured: true }] });
    click("AI 模型");
    let reject!: (error: Error) => void;
    h.api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const button = screen.getByRole("button", { name: "获取已保存配置的模型列表" });
    fireEvent.click(button); fireEvent.click(button);
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(h.api).toHaveBeenCalledWith("/api/providers/model_test/models");
    await act(async () => reject(new Error("模型读取失败")));
    expect((await screen.findByRole("alert")).textContent).toContain("模型读取失败");
    h.api.mockResolvedValueOnce({ models: [{ id: "model-new" }] });
    click("获取已保存配置的模型列表");
    await waitFor(() => expect(document.querySelector('datalist option')?.getAttribute("value")).toBe("model-new"));
    expect(h.api).toHaveBeenCalledTimes(2);
    expect(screen.getByText("设置已同步")).toBeTruthy();
  });
  it("提示词新增、编辑、切换回来保留，删除不误写服务器", () => {
    const { guard } = setup();
    click("提示词"); click("添加提示词"); input("名称", "专属提示词"); input("动作", "expand"); input("提示词模板", "扩写 {{selection}}");
    click("站点信息"); click("提示词");
    expect(screen.getByDisplayValue("专属提示词")).toBeTruthy();
    expect(screen.getByDisplayValue("扩写 {{selection}}")).toBeTruthy();
    click("删除提示词");
    expect(screen.queryByLabelText("提示词模板")).toBeNull();
    expect(guard.mock.lastCall?.[0].dirty).toBe(false);
    expect(h.api).not.toHaveBeenCalled();
  });
  it("布局、皮肤、明暗、字体独立变更，保存应用正确数据集", async () => {
    const { initial, guard, saved } = setup();
    click("主题与字体");
    fireEvent.click(screen.getByRole("button", { name: /画廊/ }));
    fireEvent.click(screen.getByRole("button", { name: /苔绿/ }));
    click("深色"); input("正文字体", "serif");
    expect(screen.getByRole("button", { name: /画廊/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /苔绿/ }).getAttribute("aria-pressed")).toBe("true");
    const response = { ...initial, theme: "garden" as const, skin: "sage" as const, mode: "dark" as const, font: "serif" as const };
    h.api.mockResolvedValueOnce({ settings: response }); click("保存设置");
    await waitFor(() => expect(saved).toHaveBeenCalledWith(response));
    expect(JSON.parse(h.api.mock.calls[0][1].body)).toEqual({ theme: "garden", skin: "sage", mode: "dark", font: "serif" });
    expect(document.documentElement.dataset).toMatchObject({ theme: "garden", skin: "sage", mode: "dark", font: "serif" });
    await waitFor(() => expect(guard.mock.lastCall?.[0].dirty).toBe(false));
  });
  it("保存失败保留草稿与 dirty，重试成功清理；连点不重复提交", async () => {
    const { initial, guard } = setup(); input("站点名称", "新站点名");
    let reject!: (error: Error) => void;
    h.api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const button = screen.getByRole("button", { name: "保存设置" }); fireEvent.click(button); fireEvent.click(button);
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("保存失败")));
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    expect(screen.getByDisplayValue("新站点名")).toBeTruthy(); expect(guard.mock.lastCall?.[0].dirty).toBe(true);
    h.api.mockResolvedValueOnce({ settings: { ...initial, siteTitle: "新站点名" } }); click("保存设置");
    await waitFor(() => expect(guard.mock.lastCall?.[0].dirty).toBe(false));
    expect(h.api).toHaveBeenCalledTimes(2);
    expect(h.api.mock.calls[1][0]).toBe("/api/settings");
    expect(h.api.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(h.api.mock.calls[1][1].body)).toEqual({ siteTitle: "新站点名" });
  });
  it("自定义代码只进入无权限 iframe 预览，不自动保存", () => {
    setup(); click("自定义代码"); input("HTML / CSS 片段", "<p>隔离内容</p>");
    const preview = screen.getByTitle("自定义代码隔离预览");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(preview.getAttribute("srcdoc")).toBe("<p>隔离内容</p>");
    expect(h.api).not.toHaveBeenCalled();
  });
});

it("设置提供独立文章类型维护入口，不再靠文章自由输入列表", async () => {
  h.api.mockResolvedValue({
    types: [
      { id: "ai", name: "AI" },
      { id: "reflection", name: "感悟" },
    ],
  });
  setup();
  click("文章类型");
  expect(screen.queryByRole("button", { name: "保存设置" })).toBeNull();
  expect(await screen.findByText("AI")).toBeTruthy();
  expect(screen.getByText("感悟")).toBeTruthy();
});

 it("文章类型入口在 SSR 水合前禁用，绑定事件后可进入", () => {
  const html = renderToString(<SettingsPanel initial={defaultSettings} authenticated />);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const button = [...doc.querySelectorAll("button")].find((node) => node.textContent === "文章类型");
  expect(button?.disabled).toBe(true);
  setup();
  expect((screen.getByRole("button", { name: "文章类型" }) as HTMLButtonElement).disabled).toBe(false);
  click("文章类型");
  expect(screen.getByRole("heading", { name: "文章类型" })).toBeTruthy();
 });
