import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  defaultSettings,
  patchSettingsSchema,
  settingsSchema,
} from "../../src/shared/contracts";
import { readSettings, writeSettings } from "../../src/server/settings";
import { fixtureEnv } from "./support";
let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => env.DB.close());
describe("外观配置协议：先测试再实现", () => {
  it("默认采用黄色皮肤、系统明暗与微软雅黑字栈", () => {
    expect(defaultSettings).toMatchObject({
      mode: "system",
      skin: "amber",
      font: "yahei",
      accent: null,
    });
  });
  it("明暗、皮肤、字体分别持久化，互相不覆盖", async () => {
    await writeSettings(env, patchSettingsSchema.parse({ mode: "dark" }));
    await writeSettings(env, patchSettingsSchema.parse({ skin: "sage" }));
    await writeSettings(env, patchSettingsSchema.parse({ font: "serif" }));
    expect(await readSettings(env)).toMatchObject({
      mode: "dark",
      skin: "sage",
      font: "serif",
    });
    await writeSettings(env, patchSettingsSchema.parse({ mode: "light" }));
    expect(await readSettings(env)).toMatchObject({
      mode: "light",
      skin: "sage",
      font: "serif",
    });
  });
  it("拒绝未定义的模式、皮肤和字体枚举", () => {
    expect(() => patchSettingsSchema.parse({ mode: "auto-magic" })).toThrow();
    expect(() => patchSettingsSchema.parse({ skin: "script" })).toThrow();
    expect(() => patchSettingsSchema.parse({ font: "download-me" })).toThrow();
  });
  it("已有配置缺少新增字段时兼容补齐默认值", () => {
    const { mode, skin, ...legacy } =
      defaultSettings as typeof defaultSettings & {
        mode?: string;
        skin?: string;
      };
    expect(settingsSchema.parse({ ...legacy, font: "sans" })).toMatchObject({
      mode: "system",
      skin: "amber",
      font: "sans",
    });
  });
});
