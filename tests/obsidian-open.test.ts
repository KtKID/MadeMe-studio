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

describe("已授权路径内定位仓库根", () => {
  async function fixture(
    markers: string[],
    failure?: { path: string; name: string },
  ) {
    const calls: string[] = [];
    const dirs = new Set(["", "nested", "nested/笔记"]);
    const handle = (path = ""): any => ({
      name: path.split("/").at(-1) || "容器",
      getDirectoryHandle: async (
        name: string,
        options: { create: boolean },
      ) => {
        expect(options.create).toBe(false);
        const next = [path, name].filter(Boolean).join("/");
        calls.push(next);
        if (next === failure?.path)
          throw new DOMException("读取失败", failure.name);
        if (dirs.has(next) || (name === ".obsidian" && markers.includes(path)))
          return handle(next);
        throw new DOMException("missing", "NotFoundError");
      },
    });
    return { root: handle(), calls };
  }
  it.each([["nested"], ["", "nested"]])(
    "嵌套仓库优先于外层配置候选 %j，不扫描兄弟目录",
    async (...markers) => {
      const { resolveObsidianUri } =
        await import("../src/modules/obsidian-local/open");
      const { root, calls } = await fixture(markers as string[]);
      const url = new URL(
        (await resolveObsidianUri(root, "nested/笔记/问 & %.md"))!,
      );
      expect(url.searchParams.get("vault")).toBe("nested");
      expect(url.searchParams.get("file")).toBe("笔记/问 & %.md");
      expect(calls).toEqual([
        "nested",
        "nested/笔记",
        "nested/笔记/.obsidian",
        "nested/.obsidian",
      ]);
    },
  );
  it("仅根有配置则保留根相对路径，无配置不猜测自定义目录", async () => {
    const { resolveObsidianUri } =
      await import("../src/modules/obsidian-local/open");
    const rootOnly = await fixture([""]);
    expect(
      new URL(
        (await resolveObsidianUri(rootOnly.root, "nested/笔记/a.md"))!,
      ).searchParams.get("file"),
    ).toBe("nested/笔记/a.md");
    expect(
      await resolveObsidianUri((await fixture([])).root, "nested/笔记/a.md"),
    ).toBeNull();
  });
  it.each(["NotAllowedError", "NotReadableError", "TypeMismatchError"])(
    "%s 不吞掉后回退到错误的外层仓库",
    async (name) => {
      const { resolveObsidianUri } =
        await import("../src/modules/obsidian-local/open");
      const { root } = await fixture([""], {
        path: "nested/笔记/.obsidian",
        name,
      });
      await expect(
        resolveObsidianUri(root, "nested/笔记/a.md"),
      ).rejects.toMatchObject({ name });
    },
  );
  it("拒绝越权路径且不读取任何目录", async () => {
    const { resolveObsidianUri } =
      await import("../src/modules/obsidian-local/open");
    const { root, calls } = await fixture([""]);
    await expect(resolveObsidianUri(root, "../a.md")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
