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
    await mkdir(join(path, ".obsidian"));
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
      expect(await readdir(path)).toEqual([".obsidian"]);
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

it("真实临时目录删除文章和图片后，原路径恢复正文与完整图片字节", async () => {
  await isolated(async (root, path) => {
    const prepared = snapshot();
    const first = await saveToDirectory(root, prepared, {
      ...options,
      createDirectories: true,
    });
    await rm(join(path, first.notePath));
    await rm(join(path, "asset", "图片.png"));
    const saved = await saveToDirectory(root, prepared, options);
    expect(saved.notePath).toBe(first.notePath);
    expect(await readFile(join(path, saved.notePath), "utf8")).toContain(
      "当前稿正文",
    );
    expect(
      new Uint8Array(await readFile(join(path, "asset", "图片.png"))),
    ).toEqual(imageBytes);
    expect(await readdir(join(path, "笔记"))).toEqual(["临时目录验收.md"]);
    expect(await readdir(join(path, "asset"))).toEqual(["图片.png"]);
  });
});

it.each([false, true])(
  "真实临时仓库根标记删除后拒绝保存且目录不变，markdownOnly=%s",
  async (markdownOnly) => {
    await isolated(async (root, path) => {
      await rm(join(path, ".obsidian"), { recursive: true });
      await expect(
        saveToDirectory(root, snapshot(), {
          ...options,
          createDirectories: true,
          markdownOnly,
        }),
      ).rejects.toThrow("这个路径没有检测到 Obsidian 仓库，请重新选择");
      expect(await readdir(path)).toEqual([]);
    });
  },
);

it("文章目录已存在时明确报告缺少图片目录，不误报文章路径", async () => {
  await isolated(async (root, path) => {
    await mkdir(join(path, "01_笔记"));
    await expect(
      saveToDirectory(root, snapshot(), {
        ...options,
        noteDirectory: "01_笔记",
      }),
    ).rejects.toMatchObject({ kind: "images", path: "asset" });
    expect(await readdir(path)).toEqual([".obsidian", "01_笔记"]);
  });
});
it.each([false, true])(
  "无媒体或仅Markdown不要求asset目录，markdownOnly=%s",
  async (markdownOnly) => {
    await isolated(async (root, path) => {
      await mkdir(join(path, "01_笔记"));
      await saveToDirectory(
        root,
        markdownOnly ? snapshot() : { ...snapshot(), media: [] },
        {
          ...options,
          noteDirectory: "01_笔记",
          markdownOnly,
        },
      );
      expect(await readdir(path)).not.toContain("asset");
    });
  },
);

it.each(["图).png", "图(.png", "中文 空格#%.png", "a[1].png", "a'b!.png"])(
  "审计：真实媒体文件 %s 经Markdown解析后仍指向存在文件",
  async (name) => {
    const { markdownToMdast } = await import("satteri");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    await isolated(async (root, path) => {
      const prepared = {
        ...snapshot(),
        media: [{ id: "media-one", name, url: "/api/files/media-one" }],
      };
      const saved = await saveToDirectory(root, prepared, {
        ...options,
        noteDirectory: "中文 空格%/笔记",
        imageRule: "../../asset",
        createDirectories: true,
      });
      const markdown = await readFile(join(path, saved.notePath), "utf8");
      const tree = markdownToMdast(markdown);
      const urls: string[] = [];
      const visit = (node: any) => {
        if (node.type === "image") urls.push(node.url);
        for (const child of node.children ?? []) visit(child);
      };
      visit(tree);
      expect(urls).toHaveLength(1);
      const actualFile = fileURLToPath(
        new URL(urls[0], pathToFileURL(join(path, saved.notePath))),
      );
      expect(await readFile(actualFile)).toEqual(Buffer.from(imageBytes));
    });
  },
);

it("审计：陌生同名目录不能阻断文章安全另名保存或改动其内容", async () => {
  await isolated(async (root, path) => {
    await mkdir(join(path, "笔记", "临时目录验收.md"), { recursive: true });
    await writeFile(
      join(path, "笔记", "临时目录验收.md", "保留.txt"),
      "用户数据",
    );
    const saved = await saveToDirectory(root, snapshot(), {
      ...options,
      createDirectories: true,
    });
    expect(saved.notePath).not.toBe("笔记/临时目录验收.md");
    expect(
      await readFile(join(path, "笔记", "临时目录验收.md", "保留.txt"), "utf8"),
    ).toBe("用户数据");
    expect(await readFile(join(path, saved.notePath), "utf8")).toContain(
      "当前稿正文",
    );
  });
});

it("审计：真实嵌套仓库中文特殊字符URI正确且不改变保存位置", async () => {
  const { resolveObsidianUri } =
    await import("../src/modules/obsidian-local/open");
  await isolated(async (root, path) => {
    const vault = "内层 仓库%";
    await mkdir(join(path, vault, ".obsidian"), { recursive: true });
    const saved = await saveToDirectory(
      root,
      { ...snapshot(), title: "标题 空格#%" },
      {
        ...options,
        noteDirectory: vault + "/01_笔记",
        createDirectories: true,
      },
    );
    const uri = new URL((await resolveObsidianUri(root, saved.notePath))!);
    expect(uri.searchParams.get("vault")).toBe(vault);
    expect(uri.searchParams.get("file")).toBe("01_笔记/标题 空格_%.md");
    expect(
      await readFile(join(path, vault, uri.searchParams.get("file")!), "utf8"),
    ).toContain("当前稿正文");
  });
});

it("审计：编辑器figure图片完整本地化并保留caption，不追加重复图", async () => {
  const { markdownToHtml } = await import("satteri");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  await isolated(async (root, path) => {
    const prepared = prepareExport(
      {
        articleId: "figure",
        title: "带说明图片",
        markdown:
          '<figure><img src="/api/files/a"><figcaption>保留说明</figcaption></figure>',
        blocks: [
          { type: "image", props: { url: "/api/files/a", name: "图).png" } },
        ],
      },
      "https://example.test",
    );
    const saved = await saveToDirectory(root, prepared, {
      ...options,
      createDirectories: true,
    });
    const html = markdownToHtml(
      await readFile(join(path, saved.notePath), "utf8"),
    ).html;
    const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)];
    expect(images).toHaveLength(1);
    expect(html).toContain("<figcaption>保留说明</figcaption>");
    expect(
      await readFile(
        fileURLToPath(
          new URL(images[0][1], pathToFileURL(join(path, saved.notePath))),
        ),
      ),
    ).toEqual(Buffer.from(imageBytes));
  });
});
it("审计：真实磁盘并发同标题不同文章不覆盖，遍历规则拒绝且不创建文件", async () => {
  await isolated(async (root, path) => {
    await mkdir(join(path, "笔记"));
    await mkdir(join(path, "asset"));
    const [a, b] = await Promise.all([
      saveToDirectory(
        root,
        { ...snapshot(), articleId: "one", markdown: "ONE" },
        options,
      ),
      saveToDirectory(
        root,
        { ...snapshot(), articleId: "two", markdown: "TWO" },
        options,
      ),
    ]);
    expect(a.notePath).not.toBe(b.notePath);
    expect(await readFile(join(path, a.notePath), "utf8")).toBe("ONE");
    expect(await readFile(join(path, b.notePath), "utf8")).toBe("TWO");
    const before = await readdir(path, { recursive: true });
    await expect(
      saveToDirectory(root, snapshot(), {
        ...options,
        noteDirectory: "../../escape",
        createDirectories: true,
      }),
    ).rejects.toThrow();
    await expect(
      saveToDirectory(root, snapshot(), {
        ...options,
        imageRule: "../../escape",
        createDirectories: true,
      }),
    ).rejects.toThrow();
    expect(await readdir(path, { recursive: true })).toEqual(before);
  });
});

it("审计：新导出媒体名兼容井号，旧井号媒体保留但不继续复用断链路径", async () => {
  const { createHash } = await import("node:crypto");
  await isolated(async (root, path) => {
    await mkdir(join(path, "asset"));
    await mkdir(join(path, "笔记"));
    await writeFile(join(path, "asset", "图#.png"), imageBytes);
    await writeFile(
      join(path, ".mademe-export.json"),
      JSON.stringify({
        version: 1,
        articles: {},
        media: {
          "media-one": {
            path: "asset/图#.png",
            digest: createHash("sha256").update(imageBytes).digest("hex"),
          },
        },
      }),
    );
    const prepared = {
      ...snapshot(),
      media: [
        { id: "media-one", name: "图#.png", url: "/api/files/media-one" },
      ],
    };
    const saved = await saveToDirectory(root, prepared, options);
    const manifest = JSON.parse(
      await readFile(join(path, ".mademe-export.json"), "utf8"),
    );
    expect(manifest.media["media-one"].path).toBe("asset/图_.png");
    expect(await readFile(join(path, "asset", "图#.png"))).toEqual(
      Buffer.from(imageBytes),
    );
    expect(await readFile(join(path, "asset", "图_.png"))).toEqual(
      Buffer.from(imageBytes),
    );
    expect(await readFile(join(path, saved.notePath), "utf8")).not.toContain(
      "%23",
    );
    expect(prepared.media[0].name).toBe("图#.png");
  });
});

it("审计：新文章文件名兼容井号但正文标题不变，旧井号稿不改不删", async () => {
  const { createHash } = await import("node:crypto");
  await isolated(async (root, path) => {
    await mkdir(join(path, "笔记"));
    const old = "# 旧稿#\n保留";
    await writeFile(join(path, "笔记", "标题#.md"), old);
    await writeFile(
      join(path, ".mademe-export.json"),
      JSON.stringify({
        version: 1,
        media: {},
        articles: {
          hashnote: {
            path: "笔记/标题#.md",
            digest: createHash("sha256").update(old).digest("hex"),
          },
        },
      }),
    );
    const prepared = prepareExport(
      { articleId: "hashnote", title: "标题#", markdown: "新稿", blocks: [] },
      "https://example.test",
    );
    const saved = await saveToDirectory(root, prepared, options);
    expect(saved.notePath).toBe("笔记/标题_.md");
    expect(await readFile(join(path, saved.notePath), "utf8")).toContain(
      "# 标题#",
    );
    expect(await readFile(join(path, "笔记", "标题#.md"), "utf8")).toBe(old);
  });
});
it.each([false, true])(
  "审计：含井号目录拒绝且无写入，markdownOnly=%s",
  async (markdownOnly) => {
    await isolated(async (root, path) => {
      await expect(
        saveToDirectory(root, snapshot(), {
          ...options,
          noteDirectory: "目录#/笔记",
          createDirectories: true,
          markdownOnly,
        }),
      ).rejects.toThrow("目录名含 #，Obsidian 无法正确打开，请选择其他目录。");
      expect(await readdir(path)).toEqual([".obsidian"]);
    });
  },
);

it("审计：真实根名或图片目录含井号均拒绝，不尝试改目录名", async () => {
  await isolated(async (root, path) => {
    await mkdir(join(path, "坏#库", ".obsidian"), { recursive: true });
    const child = await root.getDirectoryHandle("坏#库");
    await expect(
      saveToDirectory(child, snapshot(), {
        ...options,
        createDirectories: true,
      }),
    ).rejects.toThrow("目录名含 #");
    expect(await readdir(join(path, "坏#库"))).toEqual([".obsidian"]);
    await expect(
      saveToDirectory(root, snapshot(), {
        ...options,
        imageRule: "../图#库",
        createDirectories: true,
      }),
    ).rejects.toThrow("目录名含 #");
    expect(await readdir(path)).toEqual([".obsidian", "坏#库"]);
  });
});

it.each(["delete", "modify"])(
  "审计：后续图片下载期间复用图被%s，正文不得提交到已变化附件",
  async (mode) => {
    await isolated(async (root, path) => {
      const prepared = prepareExport(
        {
          articleId: "reuse-race",
          title: "复用竞态",
          markdown: "![A](/api/files/a)\n![B](/api/files/b)",
          blocks: [
            { type: "image", props: { url: "/api/files/a", name: "a.png" } },
            { type: "image", props: { url: "/api/files/b", name: "b.png" } },
          ],
        },
        "https://example.test",
      );
      const first = await saveToDirectory(root, prepared, {
        ...options,
        createDirectories: true,
      });
      const original = await readFile(join(path, first.notePath), "utf8");
      await expect(
        saveToDirectory(
          root,
          { ...prepared, markdown: "新正文\n" + prepared.markdown },
          {
            ...options,
            fetchMedia: async (url) => {
              if (url.endsWith("/b")) {
                if (mode === "delete") await rm(join(path, "asset", "a.png"));
                else await writeFile(join(path, "asset", "a.png"), "本地修改");
              }
              return options.fetchMedia();
            },
          },
        ),
      ).rejects.toThrow("本地附件已变化或被删除，未保存正文，请重试。");
      expect(await readFile(join(path, first.notePath), "utf8")).toBe(original);
      if (mode === "modify")
        expect(await readFile(join(path, "asset", "a.png"), "utf8")).toBe(
          "本地修改",
        );
    });
  },
);

it("审计：候选父目录变成文件时及时失败，不把父路径错误当同名占用无限重试", async () => {
  await isolated(async (root, path) => {
    await mkdir(join(path, "笔记"));
    await mkdir(join(path, "asset"));
    let reads = 0;
    const wrapped = {
      ...root,
      getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
        if (name === "笔记" && ++reads === 2) {
          await rm(join(path, "笔记"), { recursive: true });
          await writeFile(join(path, "笔记"), "外部新文件");
        }
        // 限定错误复现次数，避免旧实现无限Promise循环阻塞测试进程。
        if (name === "笔记" && reads > 3) throw new Error("错误的无限候选重试");
        return root.getDirectoryHandle(name, opts);
      },
    };
    await expect(
      saveToDirectory(wrapped, snapshot(), options),
    ).rejects.toMatchObject({ name: "TypeMismatchError" });
    expect(await readFile(join(path, "笔记"), "utf8")).toBe("外部新文件");
    expect(reads).toBe(2);
  });
});

it("审计：未授权创建时下载期间文章目录被删除，不得在write阶段静默重建", async () => {
  await isolated(async (root, path) => {
    await mkdir(join(path, "笔记"));
    await mkdir(join(path, "asset"));
    await expect(
      saveToDirectory(root, snapshot(), {
        ...options,
        fetchMedia: async () => {
          await rm(join(path, "笔记"), { recursive: true });
          return options.fetchMedia();
        },
      }),
    ).rejects.toThrow();
    expect(await readdir(path)).not.toContain("笔记");
  });
});
