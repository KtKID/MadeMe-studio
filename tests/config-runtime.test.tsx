import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockReader from "../src/components/content/BlockReader";
import { settingsPatch } from "../src/components/settings/settings-state";
import { configProblems } from "../src/components/settings/ConfigSection";
import { DEFAULT_CONFIG, resolveConfig } from "../src/modules/config";
import {
  configureLogLevel,
  currentLogLevel,
  logger,
} from "../src/modules/log/server";
import { hashPassword, verifyPassword } from "../src/server/auth/crypto";
import { defaultSettings } from "../src/shared/contracts";

describe("LOG_LEVEL 阈值", () => {
  afterEach(() => {
    configureLogLevel("debug");
    vi.restoreAllMocks();
  });
  it("低于阈值的日志不输出，error 始终输出", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    configureLogLevel("warn");
    expect(currentLogLevel()).toBe("warn");
    logger.info("test.info");
    logger.warn("test.warn");
    logger.error("test.error");
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
  it("非法取值回退 info，并只提示一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    configureLogLevel("loud");
    configureLogLevel("loud");
    expect(currentLogLevel()).toBe("info");
    expect(
      warn.mock.calls.filter(([line]) => String(line).includes("log.invalid_level")),
    ).toHaveLength(1);
  });
});

describe("文章密码 PBKDF2", () => {
  it("新摘要使用 100000 次（Cloudflare 生产上限），白名单内的 600000 旧/新摘要也能校验", async () => {
    const current = await hashPassword("correct horse");
    expect(current.startsWith("pbkdf2:100000:")).toBe(true);
    expect(await verifyPassword("correct horse", current)).toBe(true);
    const strong = await hashPassword("correct horse", 600000);
    expect(await verifyPassword("correct horse", strong)).toBe(true);
    expect(await verifyPassword("wrong", strong)).toBe(false);
  });
  it("白名单外的迭代次数一律拒绝（防止降级到弱参数）", async () => {
    const weak = await hashPassword("pw", 1000);
    expect(await verifyPassword("pw", weak)).toBe(false);
  });
});

describe("关闭的嵌入平台", () => {
  const x = "https://x.com/jack/status/20";
  it("已有文章里的 X 嵌入降级为跳转卡片，不加载 iframe", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[{ type: "embed", props: { url: x } }]}
        reading={{ ...DEFAULT_CONFIG.reading, disabledEmbeds: ["x"] }}
      />,
    );
    expect(html).not.toContain("<iframe");
    expect(html).toContain("data-embed-disabled");
    expect(html).toContain('href="https://x.com/jack/status/20"');
  });
  it("未关闭时使用配置的初始高度", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[{ type: "embed", props: { url: x } }]}
        reading={{ ...DEFAULT_CONFIG.reading, xInitialHeight: 500 }}
      />,
    );
    expect(html).toContain("<iframe");
    expect(html).toContain("height:500px");
  });
});

describe("设置页配置项保存", () => {
  const base = structuredClone(defaultSettings);
  it("只发送改动的叶子字段", () => {
    const next = structuredClone(base);
    next.limits.upload.videoMaxMB = 40;
    expect(settingsPatch(base, next)).toEqual({
      limits: { upload: { videoMaxMB: 40 } },
    });
  });
  it("改回默认值时发送 null（服务端删除该键，跟随默认）", () => {
    const saved = { ...base, limits: resolveConfig({ upload: { videoMaxMB: 40 } }) };
    const reset = structuredClone(saved);
    reset.limits.upload.videoMaxMB = 25;
    expect(settingsPatch(saved, reset)).toEqual({
      limits: { upload: { videoMaxMB: null } },
    });
  });
  it("没有改动时不发送 limits", () => {
    expect(settingsPatch(base, structuredClone(base))).toEqual({});
  });
  it("设置页校验：越界、空值、跨字段都给出中文原因", () => {
    const draft = structuredClone(DEFAULT_CONFIG);
    draft.upload.videoMaxMB = 80;
    draft.ai.textPerMinute = Number.NaN;
    const problems = configProblems(draft);
    expect(problems["upload.videoMaxMB"]).toContain("不能大于 50 MB");
    expect(problems["ai.textPerMinute"]).toContain("请输入数字");
    const cross = structuredClone(DEFAULT_CONFIG);
    cross.security.tokenMaxDays = 30;
    expect(configProblems(cross)["security.tokenDefaultDays"]).toContain("不能超过");
    expect(configProblems(DEFAULT_CONFIG)).toEqual({});
  });
});
