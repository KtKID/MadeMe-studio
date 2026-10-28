import { describe, expect, it } from "vitest";
import { presetSchema } from "../src/modules/obsidian-local/contracts";
import { buildObsidianUri } from "../src/modules/obsidian-local/open";
const legacy = {
  id: "a",
  name: "预设",
  vaultName: "TechNote",
  noteDirectory: "笔记",
  imageRule: "../asset",
  isVault: true,
};
describe("恢复既有Obsidian打开入口，不增用户前置条件", () => {
  it("旧预设未填擅加字段也保持原URI行为", () => {
    const preset = presetSchema.parse(legacy);
    expect(preset.obsidianVault).toBeUndefined();
    expect(preset.vaultRootConfirmed).toBeUndefined();
    expect(buildObsidianUri("TechNote", "brain/01_笔记/MadeMe.md", true)).toBe(
      `obsidian://open?vault=TechNote&file=${encodeURIComponent("brain/01_笔记/MadeMe.md")}`,
    );
  });
  it("历史额外字段继续可读，不删除预设数据", () => {
    expect(
      presetSchema.parse({
        ...legacy,
        obsidianVault: "历史值",
        vaultRootConfirmed: true,
      }),
    ).toMatchObject({
      obsidianVault: "历史值",
      vaultRootConfirmed: true,
      id: "a",
    });
  });
  it("URL参数来自当前已授权目录名与保存相对路径，分别编码特殊字符", () => {
    const name = "中文 & # + % 仓库",
      path = "中文目录/问 & # + %.md";
    const url = new URL(buildObsidianUri(name, path, true)!);
    expect(url.searchParams.size).toBe(2);
    expect(url.searchParams.get("vault")).toBe(name);
    expect(url.searchParams.get("file")).toBe(path);
  });
  it("普通目录仍保持原判断，不生成Obsidian链接", () => {
    expect(buildObsidianUri("folder", "a.md", false)).toBeNull();
  });
  it("相对路径不改变，不猜测绝对路径或注册ID", () => {
    expect(buildObsidianUri("root", "笔记/原路径.md", true)).toContain(
      encodeURIComponent("笔记/原路径.md"),
    );
    for (const path of ["/tmp/a.md", "../a.md", "笔记/../a.md", "C:\\a.md", ""])
      expect(buildObsidianUri("root", path, true)).toBeNull();
  });
});
