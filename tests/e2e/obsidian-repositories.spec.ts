import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
const fixture = resolve("tests/fixtures/markdown-media");
let code: string;
test.beforeAll(async () => {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.BASE_URL || ""))
    throw Error("Only isolated loopback allowed");
  const output = await build({
    stdin: {
      contents:
        'export * from "./src/modules/obsidian-repository/store.ts"; export * from "./src/modules/obsidian-repository/export-presets.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__testWorkspace",
    platform: "browser",
  });
  code = output.outputFiles[0].text;
});
async function api(page: Page) {
  await page.addScriptTag({ content: code });
}
async function setup(page: Page, includeSecond = false) {
  const png = await readFile(join(fixture, "中文 空格.png")),
    gif = await readFile(join(fixture, "动画.gif")),
    mp4 = await readFile(join(fixture, "片段.mp4"));
  await page.context().addInitScript(() => {
    const win = window as any;
    win.__reads = [];
    win.__writes = [];
    win.__removed = [];
    win.__modes = [];
    win.__requests = [];
    win.__audit = localStorage.getItem("repository-test-audit") === "on";
    win.__stage = "import";
    win.__rootPickCalls = 0;
    win.__childPickCalls = 0;
    const vault = async (key: string) => {
      const root = await navigator.storage.getDirectory();
      return (await root.getDirectoryHandle(key)).getDirectoryHandle("brain");
    };
    win.showDirectoryPicker = async (options: any) => {
      if (win.__cancelPick) {
        win.__cancelPick = false;
        throw new DOMException("cancel", "AbortError");
      }
      if (typeof options.startIn === "string") {
        win.__rootPickCalls++;
        return vault(win.__rootChoice || "B");
      }
      win.__childPickCalls++;
      return options.startIn.getDirectoryHandle("notes");
    };
    win.showOpenFilePicker = async (options: any) => [
      await (
        await options.startIn.getDirectoryHandle("notes")
      ).getFileHandle(win.__noteChoice || "mixed.md"),
    ];
    const base = (window as any).FileSystemHandle.prototype,
      q = base.queryPermission,
      request = base.requestPermission;
    base.queryPermission = function (options: any) {
      if (win.__audit) win.__modes.push(options.mode);
      if (win.__denyRead && options.mode === "read")
        return Promise.resolve("prompt");
      return q.call(this, options);
    };
    base.requestPermission = function (options: any) {
      win.__requests.push(options.mode);
      if (options.mode === "read") {
        win.__denyRead = false;
        return Promise.resolve("granted");
      }
      return request.call(this, options);
    };
    const file = (window as any).FileSystemFileHandle.prototype,
      get = file.getFile,
      write = file.createWritable;
    async function path(handle: any) {
      for (const key of ["A", "B"]) {
        const relative = await (await vault(key)).resolve(handle);
        if (relative) return key + "/" + relative.join("/");
      }
      return "outside";
    }
    file.getFile = async function () {
      if (win.__audit) win.__reads.push(await path(this));
      return get.call(this);
    };
    file.createWritable = async function (...args: any[]) {
      if (win.__audit) {
        if (win.__stage !== "export")
          throw Error("import/config must not write local files");
        win.__writes.push(await path(this));
      }
      return write.apply(this, args);
    };
    const directory = (window as any).FileSystemDirectoryHandle.prototype,
      remove = directory.removeEntry;
    directory.removeEntry = function (name: string, ...args: any[]) {
      if (win.__audit) {
        win.__removed.push(name);
        throw Error("configuration must not delete files");
      }
      return remove.call(this, name, ...args);
    };
  });
  await page.goto("/api/health");
  await page.evaluate(
    async (data) => {
      const root = await navigator.storage.getDirectory();
      const roots: FileSystemDirectoryHandle[] = [];
      async function put(
        vault: FileSystemDirectoryHandle,
        path: string,
        bytes: number[] | string,
      ) {
        const parts = path.split("/");
        let dir = vault;
        for (const name of parts.slice(0, -1))
          dir = await dir.getDirectoryHandle(name, { create: true });
        const file = await dir.getFileHandle(parts.at(-1)!, { create: true }),
          stream = await file.createWritable();
        await stream.write(
          typeof bytes === "string" ? bytes : new Uint8Array(bytes),
        );
        await stream.close();
      }
      for (const key of ["A", "B"]) {
        const parent = await root.getDirectoryHandle(key, { create: true }),
          vault = await parent.getDirectoryHandle("brain", { create: true });
        roots.push(vault);
        await vault.getDirectoryHandle(".obsidian", { create: true });
        await vault.getDirectoryHandle("notes", { create: true });
        await (
          await vault.getDirectoryHandle("notes")
        ).getDirectoryHandle("archive", { create: true });
        await vault.getDirectoryHandle("assets", { create: true });
        await vault.getDirectoryHandle("other", { create: true });
        const markdown =
          key === "A"
            ? "# A仓库正文\n\n![一](../assets/a.png)\n\n![二](../other/b.png)\n\n![[../assets/动画.gif]]\n\n![视频](../assets/片段.mp4)\n\n![重复](../assets/a.png)\n\n![远程视频](https://media.example.test/remote.mp4)"
            : "# B仓库正文\n\n![唯一B](../assets/b-only.png)";
        await put(vault, "notes/mixed.md", markdown);
        await put(
          vault,
          "notes/仓库.中文标题.MARKDOWN",
          "仓库原始正文，没有一级标题。",
        );
        await put(vault, "notes/escape.md", "![越界](../../private.png)");
        await put(
          vault,
          "notes/不应读取.md",
          "synthetic private note must not read",
        );
        await put(vault, "assets/a.png", data.png);
        await put(vault, "assets/b-only.png", data.png);
        await put(vault, "other/b.png", data.png);
        await put(vault, "assets/动画.gif", data.gif);
        await put(vault, "assets/片段.mp4", data.mp4);
      }
      async function save(name: string, store: string, records: any[]) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = () =>
            req.result.createObjectStore(store, {
              keyPath: store === "presets" ? "preset.id" : "id",
            });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, "readwrite");
          for (const record of records) tx.objectStore(store).put(record);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        db.close();
      }
      const preset = (
        id: string,
        name: string,
        handle: any,
        dir = "notes",
      ) => ({
        preset: {
          id,
          name,
          vaultName: "brain",
          noteDirectory: dir,
          imageRule: "../assets",
          isVault: true,
        },
        handle,
      });
      await save("mademe-obsidian-local", "presets", [
        preset("old-a1", "写作", roots[0]),
        preset("old-a2", "归档", roots[0], "notes/archive"),
        ...(data.includeSecond ? [preset("old-b", "B旧预设", roots[1])] : []),
      ]);
      await save("mademe-obsidian-repository", "connection", [
        {
          id: "active",
          revision: crypto.randomUUID(),
          name: "brain",
          handle: roots[0],
        },
      ]);
      localStorage.setItem("repository-test-audit", "on");
      (window as any).__audit = true;
    },
    { png: [...png], gif: [...gif], mp4: [...mp4], includeSecond },
  );
  return { png, gif, mp4 };
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(),
      a = await (
        await root.getDirectoryHandle("A")
      ).getDirectoryHandle("brain"),
      b = await (
        await root.getDirectoryHandle("B")
      ).getDirectoryHandle("brain");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("mademe-obsidian-workspace", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(
          ["repositories", "presets", "meta"],
          "readonly",
        ),
        out: any = {};
      let done = 0;
      for (const name of ["repositories", "presets", "meta"]) {
        const r = tx.objectStore(name).getAll();
        r.onsuccess = () => {
          out[name] = r.result;
          if (++done === 3) resolve(out);
        };
      }
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const identities = [];
    for (const repository of value.repositories)
      identities.push({
        ...repository,
        handle: undefined,
        root: (await repository.handle.isSameEntry(a))
          ? "A"
          : (await repository.handle.isSameEntry(b))
            ? "B"
            : "unknown",
      });
    return { ...value, repositories: identities };
  });
}
const card = (page: Page, id: string) =>
  page.locator(`[data-repository-id="${id}"]`);
async function selectImport(page: Page, id: string) {
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "从 Obsidian 仓库导入" });
  await expect(
    dialog.getByRole("button", { name: "选择 Markdown 文章" }),
  ).toBeVisible();
  const combo = dialog.getByRole("combobox", { name: "导入仓库" });
  if (await combo.count()) {
    await expect(
      dialog.getByRole("button", { name: "选择 Markdown 文章" }),
    ).toBeDisabled();
    await combo.click();
    await page
      .getByRole("option", { name: new RegExp(id.slice(0, 8)) })
      .click();
  }
  await dialog.getByRole("button", { name: "选择 Markdown 文章" }).click();
}

test(
  "统一仓库与子预设：旧源迁移、第二仓库、CRUD、自动附件导入及所属根导出",
  { tag: "@native-handles" },
  async ({ page, context }) => {
    test.setTimeout(120_000);
    const files = await setup(page);
    await page.goto("/studio/settings#obsidian-local");
    await expect(
      page.getByRole("heading", { name: "Obsidian 仓库", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "同步 Obsidian", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".repository-card")).toHaveCount(1);
    await expect(page.getByText("写作", { exact: true })).toBeVisible();
    await expect(page.getByText("归档", { exact: true })).toBeVisible();
    let state = await snapshot(page);
    expect(state.repositories).toHaveLength(1);
    expect(state.presets).toHaveLength(2);
    expect(state.presets.every((p: any) => !("handle" in p))).toBe(true);
    const a = state.repositories[0].id;
    await page.getByRole("button", { name: "站点信息", exact: true }).click();
    await page
      .getByRole("button", { name: "Obsidian 仓库", exact: true })
      .click();
    await expect(page.getByText("写作", { exact: true })).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Obsidian 仓库", exact: true })
      .click();
    await expect(page.getByText("归档", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      (window as any).__cancelPick = true;
    });
    await page
      .getByRole("button", { name: "新增 Obsidian 仓库", exact: true })
      .click();
    await expect(
      page.getByText("已取消新增，现有仓库与预设保持不变。", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".repository-card")).toHaveCount(1);
    await page
      .getByRole("button", { name: "新增 Obsidian 仓库", exact: true })
      .click();
    await expect(page.locator(".repository-card")).toHaveCount(2);
    state = await snapshot(page);
    const b = state.repositories.find((r: any) => r.root === "B").id;
    expect(state.repositories.every((r: any) => r.name === "brain")).toBe(true);
    expect(a).not.toBe(b);
    await card(page, b)
      .getByRole("button", { name: "新增预设", exact: true })
      .click();
    await page.getByLabel("预设名称", { exact: true }).fill("新预设");
    await page
      .getByRole("button", { name: "选择文章子目录", exact: true })
      .click();
    await page.getByLabel("图片存放规则", { exact: true }).fill("../assets");
    await page
      .getByRole("button", { name: "保存所属预设", exact: true })
      .click();
    await expect(
      card(page, b).getByText("新预设", { exact: true }),
    ).toBeVisible();
    await card(page, b)
      .getByRole("button", { name: "编辑 新预设", exact: true })
      .click();
    await page.getByLabel("预设名称", { exact: true }).fill("改名规则");
    await expect(
      card(page, a).getByText("写作", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "保存所属预设", exact: true })
      .click();
    await expect(
      card(page, b).getByText("改名规则", { exact: true }),
    ).toBeVisible();
    if (process.env.MD_UI_SCREENSHOTS) {
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: join(process.env.MD_UI_SCREENSHOTS, "repositories-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: join(process.env.MD_UI_SCREENSHOTS, "repositories-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    const response = await page.request.post("/api/posts", {
      headers: { Origin: process.env.BASE_URL! },
      data: {
        title: "隔离统一仓库草稿",
        blocks: [{ type: "paragraph", content: "原有正文" }],
      },
    });
    expect(response.status()).toBe(201);
    const { post } = await response.json();
    await page.goto("/studio/edit?id=" + post.id);
    await selectImport(page, b);
    let dialog = page.getByRole("dialog", { name: "导入 Markdown 与附件" });
    await expect(dialog).toContainText("b-only.png");
    // 删预设期间已经打开的仓库导入不能失效；仓库revision不变。
    const manager = await context.newPage();
    await manager.goto("/studio/settings#obsidian-repository");
    await card(manager, b)
      .getByRole("button", { name: "删除 改名规则", exact: true })
      .click();
    await manager
      .getByRole("button", { name: "确认删除预设", exact: true })
      .click();
    await expect(card(manager, b)).toContainText("还没有预设");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "上传附件并导入", exact: true })
      .click();
    await expect(page.locator(".bn-editor")).toContainText("B仓库正文");
    await page.route("https://media.example.test/**", (route) =>
      route.fulfill({ contentType: "video/mp4", body: files.mp4 }),
    );
    await selectImport(page, a);
    dialog = page.getByRole("dialog", { name: "导入 Markdown 与附件" });
    await expect(dialog).toContainText("已识别 6 处附件引用");
    await expect(dialog).toContainText("4 个文件上传 · 1 个链接保留");
    await expect(
      dialog.getByRole("button", { name: "补充缺失附件" }),
    ).toHaveCount(0);
    const uploads: any[] = [];
    page.on("response", (r) => {
      if (r.url().endsWith("/api/media") && r.request().method() === "POST")
        uploads.push(r);
    });
    await dialog
      .getByRole("button", { name: "上传附件并导入", exact: true })
      .click();
    await expect(page.locator(".bn-editor video")).toHaveCount(2);
    expect(uploads).toHaveLength(4);
    const receipt = await Promise.all(uploads.map((r) => r.json()));
    const saving = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith("/api/posts/" + post.id),
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    expect((await saving).status()).toBe(200);
    const importAudit = await page.evaluate(() => ({
      reads: (window as any).__reads,
      writes: (window as any).__writes,
      modes: (window as any).__modes,
      requests: (window as any).__requests,
    }));
    await page.reload();
    await expect(page.locator(".bn-editor img")).toHaveCount(4);
    await expect(page.locator(".bn-editor video")).toHaveCount(2);
    for (const video of await page.locator(".bn-editor video").all()) {
      await video.evaluate(async (el: HTMLVideoElement) => {
        el.muted = true;
        await el.play();
      });
      await page.waitForTimeout(300);
      expect(
        await video.evaluate((el: HTMLVideoElement) => el.currentTime),
      ).toBeGreaterThan(0.15);
      await video.evaluate((el: HTMLVideoElement) => el.pause());
    }
    const animated = receipt.find((r) => r.media.mime === "image/gif");
    expect(animated).toBeTruthy();
    expect(
      Buffer.from(await (await page.request.get(animated.media.url)).body()),
    ).toEqual(files.gif);
    expect(importAudit.reads).not.toContain("A/notes/不应读取.md");
    expect(importAudit.reads).toContain("A/notes/mixed.md");
    expect(importAudit.reads).toContain("B/notes/mixed.md");
    expect(importAudit.modes.length).toBeGreaterThan(0);
    expect(importAudit.writes).toEqual([]);
    expect(importAudit.requests).toEqual([]);
    expect(importAudit.modes.every((mode: string) => mode === "read")).toBe(
      true,
    );
    // 通过所属预设解析根，实际保存当前稿到A，绝不把B同名根作为默认目标。
    await page
      .getByRole("button", { name: "保存到 Obsidian", exact: true })
      .click();
    const local = page.getByRole("dialog", { name: "保存到 Obsidian" });
    await expect(
      local.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    await local.getByRole("combobox", { name: "保存预设" }).click();
    await page
      .getByRole("option", { name: new RegExp(a.slice(0, 8) + ".*写作") })
      .click();
    await local
      .getByRole("checkbox", { name: "仅下载 Markdown", exact: true })
      .check();
    await page.evaluate(() => {
      (window as any).__stage = "export";
    });
    await local.getByRole("button", { name: "保存", exact: true }).click();
    const saved = page.locator(".obsidian-save-feedback");
    await expect(saved).toContainText("已保存到本地目录");
    const savedPath = await saved.getAttribute("title");
    expect(savedPath).toBeTruthy();
    const actual = await page.evaluate(async (path) => {
      const root = await navigator.storage.getDirectory(),
        a = await (
          await root.getDirectoryHandle("A")
        ).getDirectoryHandle("brain"),
        b = await (
          await root.getDirectoryHandle("B")
        ).getDirectoryHandle("brain");
      const parts = path!.split("/");
      let dir = a;
      for (const part of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(part);
      const handle = await dir.getFileHandle(parts.at(-1)!);
      return {
        content: await (await handle.getFile()).text(),
        outsideB: await b.resolve(handle),
        writes: (window as any).__writes,
        modes: (window as any).__modes,
      };
    }, savedPath);
    expect(actual.content).toContain("A仓库正文");
    expect(actual.outsideB).toBeNull();
    expect(actual.writes.every((p: string) => p.startsWith("A/"))).toBe(true);
    expect(actual.modes).toContain("readwrite");
    await page.evaluate(() => {
      (window as any).__stage = "import";
    });
    // 删除当前根，旧导入取消；确认摘要可取消，最后仅删除其规范化配置。
    await selectImport(page, a);
    dialog = page.getByRole("dialog", { name: "导入 Markdown 与附件" });
    await expect(dialog).toBeVisible();
    await card(manager, a)
      .getByRole("button", { name: "删除仓库", exact: true })
      .click();
    let deletion = manager.getByRole("dialog", {
      name: "删除 Obsidian 仓库？",
    });
    await expect(deletion).toContainText("2 个预设");
    await expect(deletion).toContainText("写作");
    await expect(deletion).toContainText("归档");
    await deletion.getByRole("button", { name: "取消", exact: true }).click();
    await expect(card(manager, a)).toBeVisible();
    await card(manager, a)
      .getByRole("button", { name: "删除仓库", exact: true })
      .click();
    await manager
      .getByRole("button", { name: "确认删除仓库及所属预设", exact: true })
      .click();
    await expect(card(manager, a)).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".bn-editor")).toContainText("A仓库正文");
    await manager.reload();
    await manager
      .getByRole("button", { name: "Obsidian 仓库", exact: true })
      .click();
    await expect(manager.locator(".repository-card")).toHaveCount(1);
    expect((await snapshot(manager)).presets).toHaveLength(0);
    const filesRemain = await page.evaluate(async (path) => {
      const storage = await navigator.storage.getDirectory(),
        root = await (
          await storage.getDirectoryHandle("A")
        ).getDirectoryHandle("brain");
      await (await root.getDirectoryHandle("assets")).getFileHandle("a.png");
      await (await root.getDirectoryHandle("notes")).getFileHandle("mixed.md");
      let dir = root;
      const pieces = path!.split("/");
      for (const part of pieces.slice(0, -1))
        dir = await dir.getDirectoryHandle(part);
      await dir.getFileHandle(pieces.at(-1)!);
      return (window as any).__removed;
    }, savedPath);
    expect(filesRemain).toEqual([]);
    // 越根与受控权限失效：原文不变，不自动换根/放宽校验。
    await page.evaluate(() => {
      (window as any).__noteChoice = "escape.md";
    });
    await selectImport(page, b);
    await expect(
      page.getByRole("dialog", { name: "从 Obsidian 仓库导入" }),
    ).toContainText("越界");
    await page
      .getByRole("dialog", { name: "从 Obsidian 仓库导入" })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(page.locator(".bn-editor")).toContainText("A仓库正文");
    await page.evaluate(() => {
      (window as any).__noteChoice = "mixed.md";
      (window as any).__denyRead = true;
    });
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page
      .getByRole("button", { name: "选择 Markdown 文章", exact: true })
      .click();
    await page
      .getByRole("button", { name: "重新授权仓库（只读）", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__requests))
      .toEqual(["read"]);
    await page
      .getByRole("dialog", { name: "从 Obsidian 仓库导入" })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    console.log(
      JSON.stringify({
        scenario:
          "unified repositories / parent-child presets / native handles",
        legacySourcesMergedByIsSameEntry: true,
        sameNameSecondRootKept: true,
        presetDeletionPreservedOpenImport: true,
        uploads: 4,
        exportRoot: "A",
        cascadeNoDiskDelete: true,
        noResurrectionAfterReload: true,
        nativeOSPicker:
          "controlled picker with native OPFS; external OS grant NOT verified",
      }),
    );
  },
);

test(
  "迁移与级联原子性：故障回滚、并发幂等、旧摘要拒绝和删除不复活",
  { tag: "@native-handles" },
  async ({ page, context }) => {
    test.setTimeout(90_000);
    await setup(page, true);
    await api(page);
    // 原生IDB故障注入：根put已排队、子规则写入抛错，必须同事务回滚且不写完成标记。
    const failed = await page.evaluate(async () => {
      const prototype = IDBObjectStore.prototype,
        original = prototype.put;
      prototype.put = function (...args: any[]) {
        if (this.name === "presets")
          throw new DOMException("quota", "QuotaExceededError");
        return original.apply(this, args as any);
      };
      try {
        await (window as any).__testWorkspace.ensureMigration();
        return "unexpected success";
      } catch (e) {
        return (e as Error).name;
      } finally {
        prototype.put = original;
      }
    });
    expect(failed).toBe("QuotaExceededError");
    let state = await snapshot(page);
    expect(state.repositories).toHaveLength(0);
    expect(state.presets).toHaveLength(0);
    expect(state.meta).toHaveLength(0);
    const other = await context.newPage();
    await other.goto("/api/health");
    await api(other);
    await Promise.all([
      page.evaluate(() => (window as any).__testWorkspace.ensureMigration()),
      other.evaluate(() => (window as any).__testWorkspace.ensureMigration()),
    ]);
    state = await snapshot(page);
    expect(state.repositories).toHaveLength(2);
    expect(state.presets).toHaveLength(3);
    const ids = state.repositories.map((r: any) => r.id).sort();
    await page.evaluate(() =>
      (window as any).__testWorkspace.ensureMigration(),
    );
    expect(
      (await snapshot(page)).repositories.map((r: any) => r.id).sort(),
    ).toEqual(ids);
    // 两个实例同时添加同一新根也不能产生重复活动配置。
    await page.evaluate(async () => {
      const storage = await navigator.storage.getDirectory(),
        parent = await storage.getDirectoryHandle("C", { create: true }),
        root = await parent.getDirectoryHandle("brain", { create: true });
      await root.getDirectoryHandle(".obsidian", { create: true });
    });
    const insert = () =>
      page.evaluate(async () => {
        const storage = await navigator.storage.getDirectory(),
          root = await (
            await storage.getDirectoryHandle("C")
          ).getDirectoryHandle("brain");
        try {
          await (window as any).__testWorkspace.insertRepository(root);
          return true;
        } catch {
          return false;
        }
      });
    const alternate = () =>
      other.evaluate(async () => {
        const storage = await navigator.storage.getDirectory(),
          root = await (
            await storage.getDirectoryHandle("C")
          ).getDirectoryHandle("brain");
        try {
          await (window as any).__testWorkspace.insertRepository(root);
          return true;
        } catch {
          return false;
        }
      });
    expect(
      (await Promise.all([insert(), alternate()])).filter(Boolean),
    ).toHaveLength(1);
    await page.evaluate(async () => {
      const api = (window as any).__testWorkspace,
        state = await api.listWorkspace(),
        storage = await navigator.storage.getDirectory(),
        root = await (
          await storage.getDirectoryHandle("C")
        ).getDirectoryHandle("brain");
      let candidate;
      for (const repository of state.repositories)
        if (await repository.handle.isSameEntry(root)) candidate = repository;
      if (!candidate) throw Error("new root missing");
      await api.removeRepository(candidate, []);
    });
    const rollback = await page.evaluate(async () => {
      const api = (window as any).__testWorkspace,
        state = await api.listWorkspace(),
        root = state.repositories[0],
        children = state.presets.filter((p: any) => p.repositoryId === root.id),
        prototype = IDBObjectStore.prototype,
        original = prototype.delete;
      prototype.delete = function (...args: any[]) {
        if (this.name === "repositories")
          throw new DOMException("quota", "QuotaExceededError");
        return original.apply(this, args as any);
      };
      try {
        await api.removeRepository(root, children);
        return "unexpected success";
      } catch (e) {
        return (e as Error).name;
      } finally {
        prototype.delete = original;
      }
    });
    expect(rollback).toBe("QuotaExceededError");
    expect((await snapshot(page)).presets).toHaveLength(3);
    expect((await snapshot(page)).repositories).toHaveLength(2);
    const result = await page.evaluate(async () => {
      const api = (window as any).__testWorkspace,
        state = await api.listWorkspace(),
        root = state.repositories.find(
          (r: any) =>
            state.presets.filter((p: any) => p.repositoryId === r.id).length ===
            2,
        ),
        children = state.presets.filter((p: any) => p.repositoryId === root.id),
        before = await api.listExportPresets();
      await api.savePreset({
        id: crypto.randomUUID(),
        repositoryId: root.id,
        name: "并发新增",
        noteDirectory: "notes",
        imageRule: "../assets",
      });
      let rejected = false;
      try {
        await api.removeRepository(root, children);
      } catch (e) {
        rejected = String((e as Error).message).includes("重新确认");
      }
      const latest = await api.listWorkspace();
      await api.removeRepository(
        root,
        latest.presets.filter((p: any) => p.repositoryId === root.id),
      );
      let staleExport = false;
      try {
        await api.assertExportPresetCurrent(
          before.find((p: any) => p.repositoryId === root.id),
        );
      } catch {
        staleExport = true;
      }
      return { rejected, staleExport };
    });
    expect(result).toEqual({ rejected: true, staleExport: true });
    await page.reload();
    await api(page);
    const after = await page.evaluate(() =>
      (window as any).__testWorkspace.listWorkspace(),
    );
    expect(after.repositories).toHaveLength(1);
    expect(after.presets).toHaveLength(1);
    expect((await snapshot(page)).meta[0].complete).toBe(true);
    console.log(
      JSON.stringify({
        scenario: "native IndexedDB migration/cascade",
        migrationFailureRolledBack: true,
        twoInstancesIdempotent: true,
        sameNameDifferentRootSeparate: true,
        cascadeFailureRolledBack: true,
        staleConfirmationRejected: true,
        noResurrection: true,
      }),
    );
  },
);

test(
  "仓库MD无H1用中文多点文件名作标题，保存刷新保持",
  { tag: "@native-handles" },
  async ({ page }) => {
    test.setTimeout(60_000);
    await setup(page);
    await page.goto("/studio/new");
    await page.evaluate(() => {
      (window as any).__noteChoice = "仓库.中文标题.MARKDOWN";
    });
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const choosing = page.getByRole("dialog", { name: "从 Obsidian 仓库导入" });
    await expect(
      choosing.getByRole("button", { name: "选择 Markdown 文章", exact: true }),
    ).toBeVisible();
    await choosing
      .getByRole("button", { name: "选择 Markdown 文章", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "导入 Markdown 与附件" }),
    ).toContainText("仓库.中文标题.MARKDOWN");
    await expect(page.getByLabel("文章标题")).toHaveValue("");
    await page.getByRole("button", { name: "导入正文", exact: true }).click();
    await expect(page.getByLabel("文章标题")).toHaveValue("仓库.中文标题");
    await expect(page.locator(".bn-editor")).toContainText(
      "仓库原始正文，没有一级标题。",
    );
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/posts"),
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    const response = await saving;
    expect(response.status()).toBe(201);
    const { post } = await response.json();
    expect(post.title).toBe("仓库.中文标题");
    await page.goto("/studio/edit?id=" + post.id);
    await expect(page.getByLabel("文章标题")).toHaveValue("仓库.中文标题");
    await expect(page.locator(".bn-editor")).toContainText(
      "仓库原始正文，没有一级标题。",
    );
  },
);
