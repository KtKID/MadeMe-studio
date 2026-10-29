import { describe, expect, it } from "vitest";
import {
  normalizePath,
  safeName,
  saveToDirectory,
  LocalConflictError,
} from "../src/modules/obsidian-local/save";

// 内存文件系统模拟真实的 close 提交语义，不访问私人目录。
function rootFS() {
  const files = new Map<string, string | Blob>();
  const directory = (path = ""): any => ({
    name: path.split("/").at(-1) || "vault",
    getDirectoryHandle: async (name: string) => directory(path + name + "/"),
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      const p = path + name;
      if (!files.has(p) && !options?.create)
        throw new DOMException("missing", "NotFoundError");
      return {
        getFile: async () => new Blob([files.get(p) ?? ""]),
        createWritable: async () => {
          let value: string | Blob = "";
          return {
            write: async (data: string | Blob) => {
              value = data;
            },
            close: async () => {
              files.set(p, value);
            },
          };
        },
      };
    },
  });
  return { root: directory(), files };
}
const prepared = {
  articleId: "post-a",
  title: "测试",
  markdown: "# 测试\n![图](/api/files/media-a)",
  media: [{ id: "media-a", name: "图.png", url: "/api/files/media-a" }],
  warnings: [],
};
const fetchMedia = async () =>
  new Response(new Blob(["picture"], { type: "image/png" }));
const options = { noteDirectory: "笔记", imageRule: "../asset", fetchMedia };
describe("本地导出边界与事务", () => {
  it.each([false, true])(
    "实际保存必须重验根标记，markdownOnly=%s",
    async (markdownOnly) => {
      const { root, files } = rootFS();
      await saveToDirectory(root, prepared, options);
      const before = [...files.entries()];
      const original = root.getDirectoryHandle;
      let fetches = 0;
      root.getDirectoryHandle = async (name: string) => {
        if (name === ".obsidian")
          throw new DOMException("missing", "NotFoundError");
        return original(name);
      };
      await expect(
        saveToDirectory(root, prepared, {
          ...options,
          markdownOnly,
          fetchMedia: async () => {
            fetches++;
            return fetchMedia();
          },
        }),
      ).rejects.toThrow("这个路径没有检测到 Obsidian 仓库，请重新选择");
      expect(fetches).toBe(0);
      expect([...files.entries()]).toEqual(before);
    },
  );
  it.each(["NotAllowedError", "UnknownError"])(
    "根标记读取错误 %s 原样传播且无写入",
    async (name) => {
      const { root, files } = rootFS();
      const error = new DOMException("root unavailable", name);
      root.getDirectoryHandle = async () => {
        throw error;
      };
      await expect(saveToDirectory(root, prepared, options)).rejects.toBe(
        error,
      );
      expect(files.size).toBe(0);
    },
  );
  it("合法根中的文章子目录不要求自身标记", async () => {
    const { root, files } = rootFS();
    const original = root.getDirectoryHandle;
    root.getDirectoryHandle = async (name: string) => {
      const child = await original(name);
      if (name !== ".obsidian")
        child.getDirectoryHandle = async (part: string) => {
          if (part === ".obsidian")
            throw new DOMException("missing", "NotFoundError");
          return original(part);
        };
      return child;
    };
    await saveToDirectory(root, prepared, options);
    expect(files.has("笔记/测试.md")).toBe(true);
  });
  it("规范化父路径但不越授权根", () => {
    expect(normalizePath("笔记", "../asset")).toBe("asset");
    expect(() => normalizePath("", "../asset")).toThrow();
    expect(() => normalizePath("/tmp")).toThrow();
    expect(() => normalizePath("笔记", "../../secret")).toThrow();
  });
  it("安全文件名", () => {
    expect(safeName("../a:b?.md")).not.toMatch(/[/:?]/);
    expect(safeName("CON")).not.toBe("CON");
  });
  it("文字图片完整落盘并按身份重复复用", async () => {
    const { root, files } = rootFS();
    const a = await saveToDirectory(root, prepared, options);
    expect(a.notePath).toBe("笔记/测试.md");
    expect(files.has("asset/图.png")).toBe(true);
    expect(await new Blob([files.get(a.notePath)!]).text()).toContain(
      "../asset/",
    );
    const size = files.size;
    await saveToDirectory(root, prepared, options);
    expect(files.size).toBe(size);
  });
  it("图片失败不改旧正文，不报成功", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    const before = await new Blob([files.get("笔记/测试.md")!]).text();
    await expect(
      saveToDirectory(
        root,
        { ...prepared, markdown: "changed" },
        {
          ...options,
          fetchMedia: async () => new Response("", { status: 403 }),
        },
      ),
    ).rejects.toThrow();
    expect(await new Blob([files.get("笔记/测试.md")!]).text()).toBe(before);
  });
  it("本地编辑需确认，另存保留原稿", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    files.set("笔记/测试.md", "本地修改");
    await expect(
      saveToDirectory(root, prepared, options),
    ).rejects.toBeInstanceOf(LocalConflictError);
    const saved = await saveToDirectory(root, prepared, {
      ...options,
      conflict: "copy",
    });
    expect(saved.notePath).not.toBe("笔记/测试.md");
    expect(files.get("笔记/测试.md")).toBe("本地修改");
  });
  it("同名不同身份媒体不覆盖", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    await saveToDirectory(
      root,
      {
        ...prepared,
        articleId: "post-b",
        media: [{ id: "media-b", name: "图.png", url: "/api/files/media-a" }],
      },
      options,
    );
    expect(files.has("asset/图.png")).toBe(true);
    expect(
      [...files.keys()].filter((x) => x.startsWith("asset/")),
    ).toHaveLength(2);
  });
});

describe("同一事务媒体冲突", () => {
  it("预留同批同名媒体路径", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(
      root,
      {
        ...prepared,
        markdown: "![a](/api/files/a) ![b](/api/files/b)",
        media: [
          { id: "a", name: "同名.png", url: "/api/files/a" },
          { id: "b", name: "同名.png", url: "/api/files/b" },
        ],
      },
      options,
    );
    expect(
      [...files.keys()].filter((x) => x.startsWith("asset/")),
    ).toHaveLength(2);
  });
  it("下载时的本地新编辑不可覆盖", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    await expect(
      saveToDirectory(root, prepared, {
        ...options,
        fetchMedia: async () => {
          files.set("笔记/测试.md", "下载中的新编辑");
          return fetchMedia();
        },
      }),
    ).rejects.toBeInstanceOf(LocalConflictError);
    expect(files.get("笔记/测试.md")).toBe("下载中的新编辑");
  });
  it("本地媒体已改动则另存，不覆盖资产", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    files.set("asset/图.png", "私人改图");
    await saveToDirectory(root, prepared, options);
    expect(files.get("asset/图.png")).toBe("私人改图");
    expect(
      [...files.keys()].filter((x) => x.startsWith("asset/")),
    ).toHaveLength(2);
  });
});

describe("保存能力与首次读取基线", () => {
  it("缺少跨标签页锁的浏览器拒绝目录保存", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    const oldNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    });
    try {
      const { root } = rootFS();
      await expect(saveToDirectory(root, prepared, options)).rejects.toThrow(
        "跨标签页保存锁",
      );
    } finally {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
      if (oldNavigator)
        Object.defineProperty(globalThis, "navigator", oldNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });
  it("第一读之后出现的本地修改不被第二读当成授权基线", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    let reads = 0;
    const wrap = (target: any, path = ""): any => ({
      ...target,
      getDirectoryHandle: async (name: string, options: any) =>
        wrap(await target.getDirectoryHandle(name, options), path + name + "/"),
      getFileHandle: async (name: string, options: any) => {
        const handle = await target.getFileHandle(name, options);
        return {
          ...handle,
          getFile: async () => {
            const blob = await handle.getFile();
            if (path + name === "笔记/测试.md" && ++reads === 1)
              files.set("笔记/测试.md", "第一读后的本地新稿");
            return blob;
          },
        };
      },
    });
    await expect(
      saveToDirectory(wrap(root), prepared, options),
    ).rejects.toBeInstanceOf(LocalConflictError);
    expect(files.get("笔记/测试.md")).toBe("第一读后的本地新稿");
  });
});

it("新分配路径在规划后出现陌生文件，不得接受为覆盖基线", async () => {
  const { root, files } = rootFS();
  let changed = false;
  const wrap = (target: any, path = ""): any => ({
    ...target,
    getDirectoryHandle: async (name: string, options: any) =>
      wrap(await target.getDirectoryHandle(name, options), path + name + "/"),
    getFileHandle: async (name: string, options: any) => {
      try {
        return await target.getFileHandle(name, options);
      } catch (error) {
        if (path + name === "笔记/测试.md" && !changed) {
          changed = true;
          files.set("笔记/测试.md", "规划后出现的陌生文件");
        }
        throw error;
      }
    },
  });
  await expect(
    saveToDirectory(wrap(root), prepared, options),
  ).rejects.toBeInstanceOf(LocalConflictError);
  expect(files.get("笔记/测试.md")).toBe("规划后出现的陌生文件");
});

// 模拟删除、权限失效和规划后的外部创建，不把 IO 错误当作文件不存在。
function interceptReads(
  root: any,
  onRead: (path: string) => void,
  path = "",
): any {
  return {
    ...root,
    getDirectoryHandle: async (name: string, options: any) =>
      interceptReads(
        await root.getDirectoryHandle(name, options),
        onRead,
        path + name + "/",
      ),
    getFileHandle: async (name: string, options: any) => {
      if (!options?.create) onRead(path + name);
      return root.getFileHandle(name, options);
    },
  };
}

describe("删除导出文件后重新保存", () => {
  it("文章已删除时按原跟踪路径重建，而非误报本地修改", async () => {
    const { root, files } = rootFS();
    const first = await saveToDirectory(root, prepared, options);
    files.delete(first.notePath);
    const saved = await saveToDirectory(
      root,
      { ...prepared, title: "新标题" },
      options,
    );
    expect(saved.notePath).toBe(first.notePath);
    expect(await new Blob([files.get(saved.notePath)!]).text()).toContain(
      "# 测试",
    );
  });

  it("图片已删除时实际补写，不能仅凭清单跳过", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    files.delete("asset/图.png");
    await saveToDirectory(root, prepared, options);
    expect(files.has("asset/图.png")).toBe(true);
    expect(await new Blob([files.get("asset/图.png")!]).text()).toBe("picture");
  });

  it("删除文章后下载期间出现陌生文件仍拒绝覆盖", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    files.delete("笔记/测试.md");
    let downloaded = false;
    await expect(
      saveToDirectory(root, prepared, {
        ...options,
        fetchMedia: async () => {
          downloaded = true;
          files.set("笔记/测试.md", "陌生文件");
          return fetchMedia();
        },
      }),
    ).rejects.toBeInstanceOf(LocalConflictError);
    expect(downloaded).toBe(true);
    expect(files.get("笔记/测试.md")).toBe("陌生文件");
  });

  it("补写图片前出现陌生文件仍拒绝覆盖", async () => {
    const { root, files } = rootFS();
    await saveToDirectory(root, prepared, options);
    files.delete("asset/图.png");
    let reads = 0;
    const wrapped = interceptReads(root, (path) => {
      if (path === "asset/图.png" && ++reads === 3) files.set(path, "陌生图片");
    });
    await expect(
      saveToDirectory(wrapped, prepared, options),
    ).rejects.toBeInstanceOf(LocalConflictError);
    expect(files.get("asset/图.png")).toBe("陌生图片");
  });

  it.each(["NotAllowedError", "NotReadableError"])(
    "%s 不得被当作删除后重建",
    async (name) => {
      const { root, files } = rootFS();
      await saveToDirectory(root, prepared, options);
      const before = new Map(files);
      const failure = new DOMException("无法读取", name);
      const wrapped = interceptReads(root, (path) => {
        if (path === "笔记/测试.md") throw failure;
      });
      await expect(saveToDirectory(wrapped, prepared, options)).rejects.toBe(
        failure,
      );
      expect(files).toEqual(before);
    },
  );
});

it("仅Markdown在同一目录保存原始外链，不fetch或写asset，保留旧图片及manifest媒体记录", async () => {
  const { root, files } = rootFS();
  await saveToDirectory(root, prepared, options);
  const asset = files.get("asset/图.png");
  const beforeManifest = JSON.parse(String(files.get(".mademe-export.json")));
  let fetched = 0;
  const remote = {
    ...prepared,
    markdown: "![图](https://example.test/api/files/media-a)",
    media: [
      { ...prepared.media[0], url: "https://example.test/api/files/media-a" },
    ],
  };
  const saved = await saveToDirectory(root, remote, {
    ...options,
    markdownOnly: true,
    fetchMedia: async () => {
      fetched++;
      throw new Error("不能下载");
    },
  });
  expect(saved.notePath).toBe("笔记/测试.md");
  expect(fetched).toBe(0);
  expect(files.get(saved.notePath)).toBe(remote.markdown);
  expect(files.get("asset/图.png")).toBe(asset);
  expect(JSON.parse(String(files.get(".mademe-export.json"))).media).toEqual(
    beforeManifest.media,
  );
  await saveToDirectory(root, remote, { ...options, markdownOnly: true });
  expect([...files.keys()].filter((p) => p.startsWith("笔记/"))).toEqual([
    saved.notePath,
  ]);
});

it("仅Markdown首次保存不访问缺失asset目录，切回默认保存可补齐图片", async () => {
  const { root, files } = rootFS();
  const getDirectory = root.getDirectoryHandle;
  root.getDirectoryHandle = async (name: string) => {
    if (name === "asset") throw new Error("纯正文不得访问图片目录");
    return getDirectory(name);
  };
  let downloads = 0;
  const opts = {
    ...options,
    fetchMedia: async () => {
      downloads++;
      return fetchMedia();
    },
  };
  const first = await saveToDirectory(root, prepared, {
    ...opts,
    markdownOnly: true,
  });
  expect(downloads).toBe(0);
  expect([...files.keys()].some((name) => name.startsWith("asset/"))).toBe(
    false,
  );
  expect(files.get(first.notePath)).toBe(prepared.markdown);
  root.getDirectoryHandle = getDirectory;
  const full = await saveToDirectory(root, prepared, opts);
  expect(full.notePath).toBe(first.notePath);
  expect(downloads).toBe(1);
  expect(files.has("asset/图.png")).toBe(true);
  expect(String(files.get(full.notePath))).toContain("../asset/");
});
