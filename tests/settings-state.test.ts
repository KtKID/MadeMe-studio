import { describe, it, expect } from "vitest";
import { defaultSettings } from "../src/shared/contracts";
import {
  settingsPatch,
  reconcileSettingsResponse,
} from "../src/components/settings/settings-state";
describe("设置保存不丢改动", () => {
  it("只发送实际改动字段，跨窗口的mode与font不会互相覆盖", () => {
    const original = structuredClone(defaultSettings);
    expect(settingsPatch(original, { ...original, mode: "dark" })).toEqual({
      mode: "dark",
    });
    expect(settingsPatch(original, { ...original, font: "serif" })).toEqual({
      font: "serif",
    });
    const afterFirst = { ...original, mode: "dark" as const };
    const merged = {
      ...afterFirst,
      ...settingsPatch(original, { ...original, font: "serif" }),
    };
    expect(merged.mode).toBe("dark");
    expect(merged.font).toBe("serif");
  });
  it("延迟保存响应保留保存中换的字体，并继续标记dirty", async () => {
    const original = structuredClone(defaultSettings);
    const submitted = { ...original, mode: "dark" as const };
    let finish!: (value: typeof original) => void;
    const pending = new Promise<typeof original>(
      (resolve) => (finish = resolve),
    );
    const current = { ...submitted, font: "mono" as const };
    finish(submitted);
    const response = await pending;
    const next = reconcileSettingsResponse(submitted, current, response);
    expect(next.font).toBe("mono");
    expect(next.mode).toBe("dark");
    expect(settingsPatch(response, next)).toEqual({ font: "mono" });
  });
  it("未改动字段采纳服务器返回的并发更新，而新本地文案不被覆盖", () => {
    const original = structuredClone(defaultSettings);
    const submitted = { ...original, mode: "dark" as const };
    const current = { ...submitted, tagline: "请求中继续输入" };
    const server = { ...submitted, font: "serif" as const };
    const next = reconcileSettingsResponse(submitted, current, server);
    expect(next.font).toBe("serif");
    expect(next.tagline).toBe("请求中继续输入");
    expect(settingsPatch(server, next)).toEqual({ tagline: "请求中继续输入" });
  });
  it("null自定义色清除是显式修改，数组变更按字段发送", () => {
    const original = { ...structuredClone(defaultSettings), accent: "#123456" };
    expect(settingsPatch(original, { ...original, accent: null })).toEqual({
      accent: null,
    });
    expect(
      settingsPatch(defaultSettings, { ...defaultSettings, navigation: [] }),
    ).toEqual({ navigation: [] });
  });
});

it("服务端规范化返回不会把未继续编辑的空白图像模型误判为新修改", () => {
  const original = structuredClone(defaultSettings);
  const provider = {
    id: "p",
    name: "模型",
    kind: "openai" as const,
    model: "text",
    temperature: 0.7,
    maxTokens: 2048,
    configured: false,
    imageModel: "   ",
  };
  const captured = { ...original, providers: [provider] };
  const { imageModel, ...normalized } = provider;
  expect(imageModel).toBe("   ");
  const response = { ...original, providers: [normalized] };
  expect(reconcileSettingsResponse(captured, captured, response)).toEqual(
    response,
  );
  expect(
    settingsPatch(
      response,
      reconcileSettingsResponse(captured, captured, response),
    ),
  ).toEqual({});
});

it("保存请求期间确认放弃，迟到响应采用服务器基线而不复活旧草稿", () => {
  const original = structuredClone(defaultSettings);
  const submitted = { ...original, siteTitle: "已提交" };
  const response = { ...submitted, tagline: "另一个窗口修改" };
  const next = reconcileSettingsResponse(
    submitted,
    original,
    response,
    original,
  );
  expect(next).toEqual(response);
  expect(settingsPatch(response, next)).toEqual({});
});

it("放弃后返回面板重新输入，迟到保存响应只替换未再编辑字段", () => {
  const original = structuredClone(defaultSettings);
  const submitted = { ...original, siteTitle: "已提交" };
  const afterReturn = { ...original, tagline: "放弃后新输入" };
  const next = reconcileSettingsResponse(
    submitted,
    afterReturn,
    submitted,
    original,
  );
  expect(next.siteTitle).toBe("已提交");
  expect(next.tagline).toBe("放弃后新输入");
  expect(settingsPatch(submitted, next)).toEqual({ tagline: "放弃后新输入" });
});
