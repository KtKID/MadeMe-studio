import { it, expect, vi } from "vitest";
import type {
  DirectoryHandle,
  LocalFileHandle,
  PresetRecord,
} from "../../src/modules/obsidian-local/contracts";
import {
  readPresetMarkdown,
  checkPresetRead,
  authorizePresetRead,
} from "../../src/modules/markdown-import/preset-import";
import {
  inspectAttachments,
  prepareAttachments,
} from "../../src/modules/markdown-import/attachments";
class Root implements DirectoryHandle {
  name = "测试Vault";
  reads: string[] = [];
  permission: PermissionState = "granted";
  files = new Map<string, LocalFileHandle>();
  dirs = new Set(["", ".obsidian"]);
  writes = 0;
  queryPermission = vi.fn(
    async (_options: { mode: "read" | "readwrite" }) => this.permission,
  );
  requestPermission = vi.fn(
    async (_options: {
      mode: "read" | "readwrite";
    }): Promise<PermissionState> => (this.permission = "granted" as const),
  );
  put(path: string, text: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      this.dirs.add(parts.slice(0, i).join("/"));
    const item: LocalFileHandle = {
      getFile: async () => {
        this.reads.push(path);
        return new File([text], parts.at(-1)!, { lastModified: 1 });
      },
      createWritable: async () => {
        this.writes++;
        throw Error("write forbidden");
      },
    };
    this.files.set(path, item);
    return item;
  }
  async resolve(handle: DirectoryHandle | LocalFileHandle) {
    for (const [path, file] of this.files)
      if (file === handle) return path.split("/");
    return null;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    expect(options?.create).not.toBe(true);
    if (!this.dirs.has(name))
      throw new DOMException("missing", "NotFoundError");
    return this.directory(name);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    expect(options?.create).not.toBe(true);
    const file = this.files.get(name);
    if (!file) throw new DOMException("missing", "NotFoundError");
    return file;
  }
  directory(path: string): DirectoryHandle {
    const root = this;
    return {
      name: path.split("/").at(-1)!,
      getDirectoryHandle: async (name, options) => {
        expect(options?.create).not.toBe(true);
        const next = path + "/" + name;
        if (!root.dirs.has(next))
          throw new DOMException("missing", "NotFoundError");
        return root.directory(next);
      },
      getFileHandle: async (name, options) =>
        root.getFileHandle(path + "/" + name, options),
      entries: () => root.children(path),
    };
  }
  async *children(
    base: string,
  ): AsyncIterableIterator<[string, DirectoryHandle | LocalFileHandle]> {
    const prefix = base ? base + "/" : "";
    for (const path of this.dirs)
      if (
        path.startsWith(prefix) &&
        path !== base &&
        !path.slice(prefix.length).includes("/")
      )
        yield [path.slice(prefix.length), this.directory(path)];
    for (const [path, item] of this.files)
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        yield [path.slice(prefix.length), item];
  }
  entries() {
    return this.children("");
  }
  record(): PresetRecord {
    return {
      preset: {
        id: "p1",
        name: "笔记预设",
        vaultName: this.name,
        noteDirectory: "notes",
        imageRule: "../assets",
        isVault: true,
      },
      handle: this,
    };
  }
}
it("真实位置解析自动收集跨目录附件，重复引用去重，只读选中笔记与引用文件", async () => {
  const root = new Root();
  const note = root.put(
    "notes/test.md",
    "![a](../assets/a.png)\n![b](../media/b.png)\n![[../media/a.gif]]\n![视频](../media/a.mp4)\n![重复](../assets/a.png)\n![远程](https://media.example.test/a.mp4)",
  );
  for (const name of [
    "assets/a.png",
    "media/b.png",
    "media/a.gif",
    "media/a.mp4",
  ])
    root.put(name, "synthetic");
  root.put("notes/private.md", "must not read");
  const source = await readPresetMarkdown(root.record(), note, 10000);
  expect(source.preset.documentPath).toBe("notes/test.md");
  expect(source.preset.assets).toHaveLength(4);
  expect(
    inspectAttachments(
      source.markdown,
      source.preset.assets,
      source.preset.resolve,
    ).every((row) => !row.problem),
  ).toBe(true);
  let uploads = 0;
  await prepareAttachments(
    source.markdown,
    source.preset.assets,
    source.preset.resolve,
    async () => ({ url: "/api/files/item-" + ++uploads, mime: "image/png" }),
    { readFile: source.preset.readAttachment },
  );
  expect(uploads).toBe(4);
  expect(root.reads).not.toContain("notes/private.md");
  expect(root.writes).toBe(0);
  expect(
    root.queryPermission.mock.calls.every((call) => call[0].mode === "read"),
  ).toBe(true);
  expect(root.requestPermission).not.toHaveBeenCalled();
});
it("失效权限不读取正文，不自动请求；明确重新授权只请求read", async () => {
  const root = new Root();
  root.permission = "prompt";
  const note = root.put("notes/n.md", "text");
  await expect(readPresetMarkdown(root.record(), note, 1000)).rejects.toThrow(
    /重新授权/,
  );
  expect(root.reads).toEqual([]);
  expect(root.requestPermission).not.toHaveBeenCalled();
  await authorizePresetRead(root.record());
  expect(root.requestPermission).toHaveBeenCalledWith({ mode: "read" });
  await expect(checkPresetRead(root.record())).resolves.toBeUndefined();
});
it("文章必须由所选根resolve，不能靠同名或相同正文猜测", async () => {
  const a = new Root(),
    b = new Root();
  a.put("notes/same.md", "same");
  const outside = b.put("notes/same.md", "same");
  await expect(readPresetMarkdown(a.record(), outside, 1000)).rejects.toThrow(
    /不在/,
  );
  expect(b.reads).toEqual([]);
  expect(a.reads).toEqual([]);
});
it("越根引用在任何附件getFile之前失败，原文件不写", async () => {
  const root = new Root(),
    note = root.put(
      "notes/n.md",
      "![a](../assets/a.png)\n![bad](../../secret.png)",
    );
  root.put("assets/a.png", "data");
  await expect(readPresetMarkdown(root.record(), note, 1000)).rejects.toThrow(
    /越界/,
  );
  expect(root.reads).toEqual(["notes/n.md"]);
  expect(root.writes).toBe(0);
});
it("裸wiki同名歧义拒绝，不读其它文章正文；明确路径仍可选", async () => {
  const root = new Root(),
    note = root.put("notes/n.md", "![[x.png]]");
  root.put("a/x.png", "a");
  root.put("b/x.png", "b");
  root.put("private.md", "secret");
  await expect(readPresetMarkdown(root.record(), note, 1000)).rejects.toThrow(
    /同名/,
  );
  expect(root.reads).toEqual(["notes/n.md"]);
});
it("缺失引用留在清单，不能当已完成或自动上传其它文件", async () => {
  const root = new Root(),
    note = root.put("notes/n.md", "![[missing.gif]]");
  root.put("private.md", "secret");
  const source = await readPresetMarkdown(root.record(), note, 1000);
  expect(source.preset.assets).toHaveLength(0);
  expect(
    inspectAttachments(
      source.markdown,
      source.preset.assets,
      source.preset.resolve,
    )[0].problem,
  ).toMatch(/缺少/);
  expect(root.reads).toEqual(["notes/n.md"]);
});
it("预先取消不读任何文件，上传前本地附件变化拒绝", async () => {
  const root = new Root(),
    note = root.put("notes/n.md", "![a](../a.png)");
  const image = root.put("a.png", "one"),
    controller = new AbortController();
  controller.abort();
  await expect(
    readPresetMarkdown(root.record(), note, 1000, controller.signal),
  ).rejects.toThrow();
  expect(root.reads).toEqual([]);
  const source = await readPresetMarkdown(root.record(), note, 1000);
  image.getFile = async () =>
    new File(["changed"], "a.png", { lastModified: 2 });
  await expect(
    source.preset.readAttachment(source.preset.assets[0]),
  ).rejects.toThrow(/修改/);
  expect(root.writes).toBe(0);
});
it("读取权限拒绝与取消重授不改预设，不继续读文档", async () => {
  const root = new Root(),
    note = root.put("notes/n.md", "text");
  root.permission = "denied";
  root.requestPermission.mockResolvedValueOnce("denied");
  await expect(authorizePresetRead(root.record())).rejects.toThrow(/拒绝/);
  await expect(readPresetMarkdown(root.record(), note, 1000)).rejects.toThrow(
    /拒绝/,
  );
  expect(root.reads).toEqual([]);
  expect(root.writes).toBe(0);
});
it("无附件直接导入，NFC引用能匹配NFD原生目录名，不触碰其它笔记", async () => {
  const root = new Root();
  const empty = await readPresetMarkdown(
    root.record(),
    root.put("notes/empty.md", "# text"),
    1000,
  );
  expect(empty.preset.assets).toEqual([]);
  const note = root.put("notes/n.md", "![图](../media/caf%C3%A9.png)");
  root.put("media/café.png".normalize("NFD"), "synthetic");
  const source = await readPresetMarkdown(root.record(), note, 1000);
  expect(source.preset.assets).toHaveLength(1);
  expect(source.preset.assets[0].path).toBe("media/café.png");
});
it("上传前授权失效/附件移出根，不能继续读文件上传", async () => {
  const root = new Root(),
    note = root.put("notes/n.md", "![图](../a.png)");
  root.put("a.png", "data");
  const source = await readPresetMarkdown(root.record(), note, 1000);
  root.permission = "prompt";
  await expect(
    source.preset.readAttachment(source.preset.assets[0]),
  ).rejects.toThrow(/重新授权/);
  root.permission = "granted";
  root.files.delete("a.png");
  await expect(
    source.preset.readAttachment(source.preset.assets[0]),
  ).rejects.toThrow(/位置/);
});
