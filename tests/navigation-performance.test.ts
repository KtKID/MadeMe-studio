import { describe, expect, it } from "vitest";
import {
  begin,
  finish,
  restore,
  route,
  initialState,
} from "../src/modules/navigation-performance/protocol";
describe("导航性能协议", () => {
  it("只允许四个路由且剥离查询，不收集正文", () => {
    expect(route("/studio/media?secret=x")).toBe("/studio/media");
    expect(route("/article/private")).toBeNull();
  });
  it("跨文档时钟保留点击耗时，首访与重复分开", () => {
    const s = initialState();
    begin(s, "/studio", "/studio/media", 1000, "click");
    finish(s, "ready", 1400);
    expect(s.samples[0].durationMs).toBe(400);
    expect(s.samples[0].group).toBe("first-visit");
    begin(s, "/studio", "/studio/media", 2000, "click");
    expect(s.samples[1].group).toBe("repeat");
  });
  it("快速重复点击替代旧样本且不能复活", () => {
    const s = initialState();
    begin(s, "/studio", "/studio/media", 1000, "click");
    begin(s, "/studio", "/studio/settings", 1100, "click");
    expect(s.samples[0].status).toBe("superseded");
    finish(s, "canceled", 1150);
    finish(s, "ready", 1300);
    expect(s.samples[1].status).toBe("canceled");
  });
  it("失败与超时绝不成功，初始加载单列", () => {
    const s = initialState();
    begin(s, "/studio", "/studio", 1000, "initial");
    finish(s, "timeout", 31000);
    expect(s.samples[0]).toMatchObject({ kind: "initial", status: "timeout" });
  });
  it("损坏或额外私有字段不进入协议", () => {
    expect(restore("{bad")).toEqual(initialState());
    const s = initialState();
    expect(restore(JSON.stringify({ ...s, text: "private" }))).toEqual(
      initialState(),
    );
  });
});

it("新导航把未完成可见图片单独标替代，不污染内容成功", () => {
  const s = initialState();
  begin(s, "/studio", "/studio/media", 1000, "click");
  finish(s, "ready", 1200);
  s.samples[0].visibleImages = { count: 3, status: "pending" };
  begin(s, "/studio/media", "/studio/settings", 1300, "click");
  expect(s.samples[0].status).toBe("ready");
  expect(s.samples[0].visibleImages).toEqual({
    count: 3,
    status: "superseded",
    durationMs: 300,
  });
});
