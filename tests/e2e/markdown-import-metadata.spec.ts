import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const fixture = resolve("tests/fixtures/markdown-media/中文 空格.png");
const body = "这段正文应保留。";
const dialogName = "导入 Markdown 与附件";

function markdownWithCover(cid: string, bodyHasCover: boolean) {
  return [
    "---",
    `cid: ${cid}`,
    "title: 兵种模型制作手记",
    "cover: images/cover.png",
    "private_note: unselected-internal-property",
    "---",
    "",
    ...(bodyHasCover ? ["![与文章封面相同的首图](images/cover.png)", ""] : []),
    body,
  ].join("\n");
}

async function chooseMarkdown(page: Page, markdown: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page
    .getByRole("button", { name: "仅选择单个文件（不自动读取本地附件）" })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "正文.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(markdown),
  });
}

async function supplyCover(page: Page) {
  await page.getByLabel("选择附件文件").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: await readFile(fixture),
  });
}

test.beforeAll(() => {
  for (const url of [process.env.BASE_URL, process.env.SECOND_BASE_URL]) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url || ""))
      throw new Error("导入验收只允许连接隔离的本地 Worker");
  }
});

test("网页导入将首图作为独立封面，保存后作者可见 CID，访客只收到公开字段", async ({
  page,
}) => {
  const cid = "c-20261127-cover-metadata-smoke";
  await page.goto("/studio/new");
  await expect(page.getByLabel("文章标题")).toBeVisible();
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/media"))
      uploads.push(request.url());
  });
  await chooseMarkdown(page, markdownWithCover(cid, true));
  await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
  await supplyCover(page);
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/media"),
  );
  await page.getByRole("button", { name: "上传附件并导入" }).click();
  const uploaded = await upload;
  expect(uploaded.status()).toBe(201);
  const { media } = await uploaded.json();
  expect(media.url).toMatch(/^\/api\/files\//);
  const editor = page.locator(".bn-editor");
  await expect(editor).toContainText(body);
  await expect(editor.locator("img")).toHaveCount(0);
  await expect(editor).not.toContainText("images/cover.png");
  await expect(editor).not.toContainText("private_note");
  await expect(editor).not.toContainText(cid);
  const byline = page.locator(".editor-byline");
  await expect(byline).toContainText(cid);
  await expect(byline).toContainText("自己的文字，自己的空间");
  await expect(byline.getByRole("button")).toHaveCount(0);
  expect(uploads).toHaveLength(1);

  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/posts"),
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const { post } = await response.json();
  expect(post.cid).toBe(cid);
  // 检查同一张媒体进入保存请求的封面字段，正文没有重复的图片引用。
  const submitted = response.request().postDataJSON();
  expect(submitted.coverImage).toBe(media.url);
  expect(JSON.stringify(submitted.blocks)).not.toContain(media.url);
  expect(post.coverImage).toBe(media.url);
  expect(JSON.stringify(post.blocks)).not.toContain(media.url);
  expect(JSON.stringify(post)).not.toContain("unselected-internal-property");
  await page.goto(`/studio/edit?id=${post.id}`);
  await expect(byline).toContainText(cid);
  await expect(page.getByLabel("文章标题")).toHaveValue("兵种模型制作手记");
  if (process.env.MD_UI_SCREENSHOTS) {
    await page.locator(".editor-title-wrap").screenshot({
      path: join(process.env.MD_UI_SCREENSHOTS, "blog-import-owner.png"),
    });
  }

  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已发布。" }),
  ).toBeVisible();
  const guest = process.env.SECOND_BASE_URL!;
  const identity = await (
    await page.request.get(`${guest}/api/bootstrap`)
  ).json();
  expect(identity.capabilities.authenticated).toBe(false);
  for (const [path, expected] of [
    [`/api/posts/${post.id}`, "兵种模型制作手记"],
    ["/api/posts", "兵种模型制作手记"],
    ["/rss.xml", post.slug],
  ]) {
    const result = await page.request.get(`${guest}${path}`);
    expect(result.ok(), path).toBe(true);
    const text = await result.text();
    expect(text).toContain(expected);
    expect(text).not.toContain(cid);
    expect(text).not.toContain('"cid":');
  }
  await page.goto(`${guest}/p/${post.slug}`);
  const cover = page.locator(".reading-cover img");
  await expect(cover).toHaveCount(1);
  await expect
    .poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator(".reading-prose img")).toHaveCount(0);
  await expect(page.locator(".reading-prose")).toContainText(body);
  expect(await page.content()).not.toContain(cid);
  if (process.env.MD_UI_SCREENSHOTS)
    await page.screenshot({
      path: join(process.env.MD_UI_SCREENSHOTS, "blog-import-reader.png"),
    });

  await page.goto("/studio/new");
  await chooseMarkdown(page, markdownWithCover(cid, true));
  await expect(page.getByText(/CID.*占用/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: dialogName })).toHaveCount(0);
  await expect(page.locator(".editor-byline")).not.toContainText(cid);
  expect(uploads).toHaveLength(1);
});

test("只在属性区引用封面仍可导入，缺图时草稿保持原样", async ({ page }) => {
  const cid = "c-20261127-cover-only-smoke";
  await page.goto("/studio/new");
  const title = page.getByLabel("文章标题");
  await title.fill("当前稿件的标题");
  await chooseMarkdown(page, markdownWithCover(cid, false));
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toContainText("cover.png");
  await expect(
    dialog.getByRole("button", { name: "补充缺失附件" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "上传附件并导入" }),
  ).toHaveCount(0);
  await expect(title).toHaveValue("当前稿件的标题");
  await expect(page.locator(".editor-byline")).not.toContainText(cid);
  await supplyCover(page);
  await dialog.getByRole("button", { name: "上传附件并导入" }).click();
  await expect(page.locator(".bn-editor")).toContainText(body);
  await expect(page.locator(".editor-byline")).toContainText(cid);
  await expect(title).toHaveValue("当前稿件的标题");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/posts"),
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const { post } = await response.json();
  expect(post.coverImage).toMatch(/^\/api\/files\//);
});
