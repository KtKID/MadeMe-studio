import { test, expect } from "@playwright/test";
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "vite";

const fixtures = resolve("tests/fixtures/markdown-media");
const mixed =
  "# 合成附件测试\n\n正文保留。\n\n![中文图片](<../自媒体/assets/中文 空格.png>)\n\n![编码重复](../自媒体/assets/中文%20空格.png)\n\n![[自媒体/assets/动画.gif|动图]]\n\n![[自媒体/assets/片段.mp4|视频]]\n\n![[自媒体/assets/片段.mov|MOV视频]]\n";
let vault: string;
test.beforeAll(async () => {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.BASE_URL || ""))
    throw Error("Only isolated loopback Worker allowed");
  vault = await mkdtemp(join(tmpdir(), "mademe-md-fixtures-"));
  await mkdir(join(vault, "文章"), { recursive: true });
  await mkdir(join(vault, "自媒体/assets"), { recursive: true });
  for (const name of ["中文 空格.png", "动画.gif", "片段.mp4", "片段.mov"])
    await copyFile(join(fixtures, name), join(vault, "自媒体/assets", name));
  await writeFile(join(vault, "文章/mixed.md"), mixed);
  await writeFile(
    join(vault, "自媒体/assets/unreferenced.txt"),
    "Must never upload",
  );
});
test.afterAll(async () => {
  if (vault) await rm(vault, { recursive: true, force: true });
});
async function seed(page: import("@playwright/test").Page) {
  const response = await page.request.post("/api/posts", {
    headers: { Origin: process.env.BASE_URL! },
    data: {
      title: "隔离合成草稿",
      blocks: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "原有输入必须保留", styles: {} }],
          children: [],
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const { post } = await response.json();
  await page.goto(`/studio/edit?id=${post.id}`);
  await expect(page.locator(".bn-editor")).toBeVisible();
  return post.id;
}
async function open(page: import("@playwright/test").Page, markdown = mixed) {
  await page
    .locator('input[type=file][accept*=".markdown"]')
    .setInputFiles({
      name: "mixed.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
  await expect(
    page.getByRole("dialog", { name: "导入 Markdown 与附件" }),
  ).toBeVisible();
}
const flatten = (blocks: any[]): any[] =>
  blocks.flatMap((block) => [block, ...flatten(block.children || [])]);

test("真实文件夹导入：PNG/中文空格/编码/wiki/GIF/MP4/MOV → 上传、保存、刷新、播放", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const id = await seed(page);
  const uploaded: any[] = [];
  page.on("response", (response) => {
    if (
      response.url().endsWith("/api/media") &&
      response.request().method() === "POST"
    )
      uploaded.push(response);
  });
  await page
    .locator('input[type=file][accept*=".markdown"]')
    .setInputFiles(join(vault, "文章/mixed.md"));
  await page.getByLabel("选择共同上级文件夹").setInputFiles(vault);
  await page
    .getByRole("button", { name: "上传附件并导入", exact: true })
    .click();
  await expect(
    page.getByText("已导入 Markdown，请检查排版后保存。", { exact: true }),
  ).toBeVisible();
  expect(uploaded).toHaveLength(4); // 同图引用两次只传一次；目录内无关 TXT 不上传。
  const media = await Promise.all(
    uploaded.map(async (response) => {
      expect(response.status()).toBe(201);
      return (await response.json()).media;
    }),
  );
  expect(media.map((item) => item.mime)).toEqual([
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/quicktime",
  ]);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/posts/${id}`),
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const { post } = await (await page.request.get(`/api/posts/${id}`)).json();
  expect(post.visibility).toBe("draft");
  expect(post.publishedAt).toBeNull();
  const blocks = flatten(post.blocks).filter((block) =>
    ["image", "video"].includes(block.type),
  );
  expect(blocks.map((block) => block.type)).toEqual([
    "image",
    "image",
    "image",
    "video",
    "video",
  ]);
  expect(
    blocks.every((block) =>
      /^\/api\/files\/[a-zA-Z0-9-]+$/.test(block.props.url),
    ),
  ).toBe(true);
  expect(blocks[0].props.url).toBe(blocks[1].props.url);
  await page.reload();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".bn-editor img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  // GIF 原字节及帧时间轴保留，并由实际浏览器解码两帧验证颜色变化。
  const gif = media.find((item) => item.mime === "image/gif");
  expect(Buffer.from(await (await page.request.get(gif.url)).body())).toEqual(
    await readFile(join(fixtures, "动画.gif")),
  );
  const frames = await page.evaluate(async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    const decoder = new (window as any).ImageDecoder({
      data: bytes,
      type: "image/gif",
    });
    await decoder.tracks.ready;
    const pixels = [];
    for (const frameIndex of [0, 1]) {
      const { image } = await decoder.decode({ frameIndex });
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      pixels.push([...ctx.getImageData(1, 1, 1, 1).data]);
      image.close();
    }
    return { count: decoder.tracks.selectedTrack.frameCount, pixels };
  }, gif.url);
  expect(frames.count).toBe(2);
  expect(frames.pixels[0]).not.toEqual(frames.pixels[1]);
  const displayedGif = page.locator(`.bn-editor img[src="${gif.url}"]`);
  await displayedGif.scrollIntoViewIfNeeded();
  const displayedFrames = new Set<string>();
  for (let sample = 0; sample < 5; sample++) {
    displayedFrames.add((await displayedGif.screenshot()).toString("base64"));
    await page.waitForTimeout(130); // 采样实际 GIF 播放帧，而非只检查文件头。
  }
  expect(displayedFrames.size).toBeGreaterThan(1);
  for (let i = 0; i < 2; i++) {
    const video = page.locator(".bn-editor video").nth(i);
    await video.scrollIntoViewIfNeeded();
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.2);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
  }
  console.log(
    JSON.stringify({
      importedDraft: id,
      uploadedMimes: media.map((item) => item.mime),
      uploadedSizes: media.map((item) => item.size),
      gifFrameCount: frames.count,
      mp4AndH264MovPlayback: true,
    }),
  );
});

test("上传中重复确认只发一次；期间新增输入阻止旧 Markdown 覆盖", async ({
  page,
}) => {
  await seed(page);
  await open(page, "![[中文 空格.png]]");
  await page
    .getByLabel("选择附件文件")
    .setInputFiles(join(fixtures, "中文 空格.png"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploads = 0;
  await page.route("**/api/media", async (route) => {
    uploads++;
    await gate;
    await route.continue();
  });
  const requested = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/media") && request.method() === "POST",
  );
  await page
    .getByRole("button", { name: "上传附件并导入" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await requested;
  await page.getByLabel("文章标题").fill("上传期间新输入", { force: true });
  release();
  await expect(page.getByText(/导入未完成，当前正文已保留/)).toBeVisible();
  expect(uploads).toBe(1);
  await expect(page.getByLabel("文章标题")).toHaveValue("上传期间新输入");
  await expect(page.locator(".bn-editor")).toContainText("原有输入必须保留");
});

test("缺失/不支持/网络失败/取消：保留原正文，不发保存请求；重试复用已上传附件", async ({
  page,
}) => {
  const id = await seed(page);
  await open(page);
  await expect(
    page.getByRole("button", { name: "上传附件并导入" }),
  ).toBeDisabled();
  await expect(page.getByText(/缺少附件/)).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.locator(".bn-editor")).toContainText("原有输入必须保留");
  await open(page, "![[bad.svg]]");
  await page
    .getByLabel("选择附件文件")
    .setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
  await expect(page.getByText(/不支持此嵌入附件格式/)).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await open(page, "![[中文 空格.png]]\n\n![[动画.gif]]");
  await page
    .getByLabel("选择附件文件")
    .setInputFiles([
      join(fixtures, "中文 空格.png"),
      join(fixtures, "动画.gif"),
    ]);
  let calls = 0;
  await page.route("**/api/media", async (route) => {
    calls++;
    if (calls === 2) await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "上传附件并导入" }).click();
  await expect(page.getByText(/导入未完成，当前正文已保留/)).toBeVisible();
  await expect(page.locator(".bn-editor")).toContainText("原有输入必须保留");
  expect(
    (await (await page.request.get(`/api/posts/${id}`)).json()).post.version,
  ).toBe(1);
  await page.getByRole("button", { name: "上传附件并导入" }).click();
  await expect(
    page.getByText("已导入 Markdown，请检查排版后保存。", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(3); // PNG 不重复上传。
  await page.unroute("**/api/media");
  await open(page, "![[中文 空格.png]]");
  await page
    .getByLabel("选择附件文件")
    .setInputFiles(join(fixtures, "中文 空格.png"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/media", async (route) => {
    await gate;
    await route.abort();
  });
  await page.getByRole("button", { name: "上传附件并导入" }).click();
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  release();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".bn-editor img")).toHaveCount(2);
});

test("插件共享客户端：真实上传/API 私有草稿；旧客户端未解析地址明确422", async ({
  request,
}) => {
  const origin = process.env.BASE_URL!;
  const credential = await (
    await request.post("/api/tokens", {
      headers: { Origin: process.env.BASE_URL! },
      data: {
        name: "isolated-md-attachments",
        scopes: ["posts:write", "media:write"],
        expiresInDays: 1,
      },
    })
  ).json();
  const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    cacheDir: join(vault, "vite-cache"),
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { createDraftWithAttachments, createDraft } =
      await vite.ssrLoadModule("/integrations/shared/client.ts");
    const assets = await Promise.all(
      ["中文 空格.png", "动画.gif", "片段.mp4", "片段.mov"].map(
        async (name) => ({
          path: `自媒体/assets/${name}`,
          file: new File([await readFile(join(fixtures, name))], name),
        }),
      ),
    );
    const calls: any[] = [];
    const receipt = await createDraftWithAttachments({
      site: origin,
      token: credential.token,
      title: "插件合成测试",
      markdown: mixed,
      assets,
      resolve: { mode: "root", documentPath: "文章/mixed.md" },
      fetchImpl: async (url: string, options: RequestInit) => {
        const res = await fetch(url, options);
        calls.push({ path: new URL(url).pathname, status: res.status });
        return res;
      },
    });
    const { post } = await (
      await request.get(`/api/posts/${receipt.id}`)
    ).json();
    expect(post.visibility).toBe("draft");
    expect(post.publishedAt).toBeNull();
    expect(
      flatten(post.blocks).filter((block) => block.type === "video"),
    ).toHaveLength(2);
    expect(
      flatten(post.blocks).filter((block) => block.type === "image"),
    ).toHaveLength(3);
    expect(calls.filter((call) => call.path === "/api/media")).toHaveLength(4);
    const old = await request.post("/api/posts", {
      headers: { Origin: process.env.BASE_URL! },
      data: {
        title: "旧客户端",
        markdown:
          "![old](../自媒体/assets/mingting-mvp-zcode-success-20261101.png)",
      },
    });
    expect(old.status()).toBe(422);
    expect((await old.json()).error.code).toBe("UNRESOLVED_ATTACHMENT");
    await expect(
      createDraft({
        site: origin,
        token: credential.token,
        title: "旧插件",
        markdown: "![[missing.gif]]",
      }),
    ).rejects.toThrow();
    console.log(
      JSON.stringify({
        sharedClientReceipt: receipt.id,
        calls,
        nativeObsidianApp: "not installed/not executed",
      }),
    );
  } finally {
    await vite.close();
  }
});
