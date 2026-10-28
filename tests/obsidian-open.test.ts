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
describe("本地目录与Obsidian登记身份分离", () => {
  it("旧预设迁移不把目录名当成已确认的Obsidian身份", () => {
    const p = presetSchema.parse(legacy);
    expect(p.obsidianVault).toBe("");
    expect(p.vaultRootConfirmed).toBe(false);
    expect(buildObsidianUri(p, "笔记/文章.md", true)).toBeNull();
  });
  it("采用用户明确的登记名称而不是handle目录名", () => {
    const p = presetSchema.parse({
      ...legacy,
      obsidianVault: "实际仓库",
      vaultRootConfirmed: true,
    });
    const url = new URL(buildObsidianUri(p, "笔记/文章.md", true)!);
    expect(url.searchParams.get("vault")).toBe("实际仓库");
    expect(url.searchParams.get("file")).toBe("笔记/文章.md");
  });
  it("中文和特殊字符分别编码，不注入额外查询参数", () => {
    const p = presetSchema.parse({
      ...legacy,
      obsidianVault: "中文 & # + % 仓库",
      vaultRootConfirmed: true,
    });
    const uri = buildObsidianUri(p, "中文目录/问 & # + %.md", true)!;
    const url = new URL(uri);
    expect(url.searchParams.size).toBe(2);
    expect(url.searchParams.get("vault")).toBe(p.obsidianVault);
    expect(url.searchParams.get("file")).toBe("中文目录/问 & # + %.md");
    expect(uri).not.toContain("中文");
  });
  it("允许明确配置官方仓库ID", () => {
    expect(
      buildObsidianUri(
        presetSchema.parse({
          ...legacy,
          obsidianVault: "ef6ca3e3b524d22f",
          vaultRootConfirmed: true,
        }),
        "a.md",
        true,
      ),
    ).toContain("vault=ef6ca3e3b524d22f");
  });
  it("未确认根目录、未配置及普通文件夹不生成打开链接", () => {
    const p = presetSchema.parse({
      ...legacy,
      obsidianVault: "registered",
      vaultRootConfirmed: true,
    });
    expect(buildObsidianUri(p, "a.md", false)).toBeNull();
    expect(
      buildObsidianUri({ ...p, vaultRootConfirmed: false }, "a.md", true),
    ).toBeNull();
    expect(
      buildObsidianUri({ ...p, obsidianVault: "" }, "a.md", true),
    ).toBeNull();
  });
  it("拒绝绝对/越根/非规范相对路径，不猜绝对地址", () => {
    const p = presetSchema.parse({
      ...legacy,
      obsidianVault: "registered",
      vaultRootConfirmed: true,
    });
    for (const path of ["/tmp/a.md", "../a.md", "笔记/../a.md", "C:\\a.md", ""])
      expect(buildObsidianUri(p, path, true)).toBeNull();
  });
});
