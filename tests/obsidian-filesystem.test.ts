import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareExport } from "../src/modules/local-export/prepare";
import {
  saveToDirectory,
  LocalConflictError,
  MissingDirectoryError,
} from "../src/modules/obsidian-local/save";
import type {
  DirectoryHandle,
  LocalFileHandle,
} from "../src/modules/obsidian-local/contracts";

/** Node 临时目录适配器仅验证真实字节/文件名/close 提交，不冒充浏览器原生授权。 */
function temporaryDirectoryHandle(path: string): DirectoryHandle {
  function child(name: string) {
    if (!name || name === "." || name === ".." || /[\\/\0]/.test(name))
      throw new Error("测试句柄只允许单个路径段");
    return join(path, name);
  }
  async function inspect(path: string) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("隔离测试不允许符号链接");
      return info;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new DOMException("不存在", "NotFoundError");
      throw error;
    }
  }
  return {
    name: basename(path),
    async getDirectoryHandle(name, options) {
      const target = child(name);
      if (options?.create) await mkdir(target, { recursive: true });
      if (!(await inspect(target)).isDirectory())
        throw new DOMException("不是目录", "TypeMismatchError");
      return temporaryDirectoryHandle(target);
    },
    async getFileHandle(name, options): Promise<LocalFileHandle> {
      const target = child(name);
      if (options?.create) {
        // wx 只创建不存在的空文件，不截断用户已有内容。
        try {
          await writeFile(target, "", { flag: "wx" });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      if (!(await inspect(target)).isFile())
        throw new DOMException("不是文件", "TypeMismatchError");
      return {
        async getFile() {
          return new File([await readFile(target)], name);
        },
        async createWritable() {
          const staging = child(`.write-${crypto.randomUUID()}`);
          return {
            async write(data) {
              await writeFile(
                staging,
                data instanceof Blob
                  ? Buffer.from(await data.arrayBuffer())
                  : data,
              );
            },
            async close() {
              await rename(staging, target);
            },
            async abort() {
              await rm(staging, { force: true });
            },
          };
        },
      };
    },
  };
}
async function isolated(
  run: (root: DirectoryHandle, path: string) => Promise<void>,
) {
  const path = await mkdtemp(join(tmpdir(), "mademe-obsidian-filesystem-"));
  try {
    await run(temporaryDirectoryHandle(path), path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
const imageBytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 42,
]);
const options = {
  noteDirectory: "笔记",
  imageRule: "../asset",
  fetchMedia: async () =>
    new Response(imageBytes, { headers: { "content-type": "image/png" } }),
};
const snapshot = () =>
  prepareExport(
    {
      articleId: "article-one",
      title: "临时目录验收",
      markdown: "当前稿正文\n\n![图片](/api/files/media-one)",
      blocks: [
        { type: "paragraph", content: "当前稿正文" },
        {
          type: "image",
          props: { url: "/api/files/media-one", name: "图片.png" },
        },
      ],
    },
    "https://example.test",
  );

describe("本地导出真实临时文件系统端到端", () => {
  it("缺目录必须先确认，然后正文及图片实际落盘，重复导出按身份复用", async () =>
    isolated(async (root, path) => {
      await expect(
        saveToDirectory(root, snapshot(), options),
      ).rejects.toBeInstanceOf(MissingDirectoryError);
      expect(await readdir(path)).toEqual([]);
      const first = await saveToDirectory(root, snapshot(), {
        ...options,
        createDirectories: true,
      });
      const markdown = await readFile(join(path, first.notePath), "utf8");
      expect(markdown).toContain("# 临时目录验收");
      expect(markdown).toContain("当前稿正文");
      expect(markdown).toContain(`../asset/${encodeURIComponent("图片.png")}`);
      expect(await readFile(join(path, "asset", "图片.png"))).toEqual(
        Buffer.from(imageBytes),
      );
      const before = await readdir(path, { recursive: true });
      const second = await saveToDirectory(root, snapshot(), options);
      expect(second.notePath).toBe(first.notePath);
      expect(await readdir(path, { recursive: true })).toEqual(before);
      expect(
        (await readdir(path, { recursive: true })).some((name) =>
          name.includes(".write-"),
        ),
      ).toBe(false);
    }));

  it("磁盘上用户改过正文，拒绝直接覆盖；另存保留原文件字节", async () =>
    isolated(async (root, path) => {
      const first = await saveToDirectory(root, snapshot(), {
        ...options,
        createDirectories: true,
      });
      await writeFile(
        join(path, first.notePath),
        "用户在本地修改的原稿\n",
        "utf8",
      );
      await expect(
        saveToDirectory(root, snapshot(), options),
      ).rejects.toBeInstanceOf(LocalConflictError);
      const copy = await saveToDirectory(root, snapshot(), {
        ...options,
        conflict: "copy",
      });
      expect(copy.notePath).not.toBe(first.notePath);
      expect(await readFile(join(path, first.notePath), "utf8")).toBe(
        "用户在本地修改的原稿\n",
      );
      expect(await readFile(join(path, copy.notePath), "utf8")).toContain(
        "当前稿正文",
      );
    }));

  it("同名不同媒体 ID 与长中文名实际创建独立可读文件", async () =>
    isolated(async (root, path) => {
      const longName = `${"长中文图片名称".repeat(45)}.png`;
      const prepared = prepareExport(
        {
          articleId: "article-long",
          title: "长文件名",
          markdown: "![一](/api/files/a) ![二](/api/files/b)",
          blocks: [
            { type: "image", props: { url: "/api/files/a", name: longName } },
            { type: "image", props: { url: "/api/files/b", name: longName } },
          ],
        },
        "https://example.test",
      );
      const saved = await saveToDirectory(root, prepared, {
        ...options,
        createDirectories: true,
        fetchMedia: async (url) =>
          new Response(
            url.endsWith("/a") ? imageBytes : new Uint8Array([1, 2, 3]),
            { headers: { "content-type": "image/png" } },
          ),
      });
      const files = await readdir(join(path, "asset"));
      expect(files).toHaveLength(2);
      for (const file of files) {
        expect(Buffer.byteLength(file)).toBeLessThanOrEqual(255);
        expect(file).toMatch(/\.png$/);
      }
      const byteValues = await Promise.all(
        files.map((file) => readFile(join(path, "asset", file))),
      );
      expect(byteValues).toContainEqual(Buffer.from(imageBytes));
      expect(byteValues).toContainEqual(Buffer.from([1, 2, 3]));
      const markdown = await readFile(join(path, saved.notePath), "utf8");
      for (const file of files)
        expect(markdown).toContain(`../asset/${encodeURIComponent(file)}`);
    }));
});
