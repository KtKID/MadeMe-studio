import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
async function seed(
  request: APIRequestContext,
  baseURL: string | undefined,
  cover = false,
) {
  const origin = new URL(baseURL!).origin;
  expect(
    (await (await request.get("/api/bootstrap")).json()).capabilities
      .authenticated,
  ).toBe(true);
  let url = "";
  if (cover) {
    const r = await request.post("/api/media", {
      headers: { Origin: origin },
      multipart: {
        file: {
          name: "conflict-fixture.png",
          mimeType: "image/png",
          buffer: readFileSync("tests/fixtures/valid-image.png"),
        },
      },
    });
    expect(r.ok()).toBe(true);
    url = (await r.json()).media.url;
  }
  const r = await request.post("/api/posts", {
    headers: { Origin: origin },
    data: {
      title: "并发编辑隔离样例",
      coverImage: url,
      blocks: [
        {
          id: crypto.randomUUID(),
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "原始正文", styles: {} }],
          children: [],
        },
      ],
    },
  });
  expect(r.ok()).toBe(true);
  return (await r.json()).post;
}
const body = (p: Page) =>
  p
    .locator(
      '.bn-editor[contenteditable="true"],.bn-editor [contenteditable="true"]',
    )
    .first();
async function editBody(p: Page, text: string) {
  await expect(body(p)).toBeVisible();
  await body(p).click();
  await p.keyboard.press("ControlOrMeta+A");
  await p.keyboard.insertText(text);
}
async function save(p: Page) {
  await p.getByRole("button", { name: "保存草稿", exact: true }).click();
}
async function open(p: Page, id: string) {
  await p.goto(`/studio/edit?id=${id}`);
  await expect(p.getByLabel("文章标题")).toBeVisible();
  await expect(body(p)).toBeVisible();
}
test("@author 删除真实封面后旧窗口不得覆盖另一窗口新标题正文", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const post = await seed(request, baseURL, true),
    b = await context.newPage();
  await open(page, post.id);
  await open(b, post.id);
  await b.getByLabel("文章标题").fill("B窗口新标题");
  await editBody(b, "B窗口新正文");
  await save(b);
  await expect(b.getByRole("status")).toContainText("草稿已保存");
  const sent: { version: number; title: string; status: number }[] = [];
  page.on("response", async (r) => {
    if (
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname === `/api/posts/${post.id}`
    ) {
      const data = r.request().postDataJSON();
      sent.push({
        version: data.version,
        title: data.title,
        status: r.status(),
      });
    }
  });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "更换图片" }).click();
  await page
    .getByRole("dialog", { name: "选择封面图片" })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "删除素材" })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "这份素材正在被使用" })
    .getByRole("button", { name: "仍然删除" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "这份素材正在被使用" }),
  ).not.toBeVisible();
  await page
    .getByRole("dialog", { name: "选择封面图片" })
    .getByRole("button", { name: "关闭" })
    .click();
  await page
    .getByRole("dialog", { name: "让你的文字被看见" })
    .getByRole("button", { name: "关闭" })
    .click();
  await save(page);
  await expect(page.getByRole("status")).toContainText("已安全合并");
  const final = (await (await request.get(`/api/posts/${post.id}`)).json())
    .post;
  expect(final.title).toBe("B窗口新标题");
  expect(JSON.stringify(final.blocks)).toContain("B窗口新正文");
  expect(final.coverImage).toBe("");
  expect(sent[0]).toMatchObject({ version: 1, status: 409 });
  expect(sent[1]).toMatchObject({
    version: 3,
    title: "B窗口新标题",
    status: 200,
  });
  await b.close();
});
test("@author 正文二选一：本地副本持久恢复与真实双窗口冲突", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const post = await seed(request, baseURL),
    b = await context.newPage();
  await open(page, post.id);
  await open(b, post.id);
  await editBody(page, "A窗口未保存的整篇正文");
  await editBody(b, "B窗口已保存的整篇正文");
  await save(b);
  await expect(b.getByRole("status")).toContainText("草稿已保存");
  await save(page);
  const dialog = page.getByRole("dialog", { name: "处理版本冲突" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("正文（整篇）");
  if (process.env.CONFLICT_SCREENSHOT_DIR) {
    const directory = process.env.CONFLICT_SCREENSHOT_DIR;
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: join(directory, "desktop.png") });
    await page.setViewportSize({ width: 412, height: 915 });
    await expect
      .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await page.screenshot({ path: join(directory, "mobile.png") });
  }
  await dialog
    .getByRole("button", { name: "保留我的副本，再加载最新版" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(body(page)).toContainText("B窗口已保存的整篇正文");
  await page.reload();
  await expect(body(page)).toBeVisible();
  await page.getByRole("button", { name: "本地副本", exact: true }).click();
  await page.getByRole("button", { name: "恢复这份副本到编辑器" }).click();
  await expect(body(page)).toContainText("A窗口未保存的整篇正文");
  expect(
    JSON.stringify(
      (await (await request.get(`/api/posts/${post.id}`)).json()).post.blocks,
    ),
  ).toContain("B窗口已保存的整篇正文");
  await save(page);
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "保留我的版本", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const final = (await (await request.get(`/api/posts/${post.id}`)).json())
    .post;
  expect(JSON.stringify(final.blocks)).toContain("A窗口未保存的整篇正文");
  expect(JSON.stringify(final.blocks)).not.toContain("B窗口已保存的整篇正文");
  await b.close();
});
test("@author 选择本地版本时服务器再次变化，重新冲突且保留本地", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const post = await seed(request, baseURL),
    b = await context.newPage();
  await open(page, post.id);
  await open(b, post.id);
  await page.getByLabel("文章标题").fill("A本地标题");
  await b.getByLabel("文章标题").fill("B第一次标题");
  await save(b);
  await expect(b.getByRole("status")).toContainText("草稿已保存");
  await save(page);
  const dialog = page.getByRole("dialog", { name: "处理版本冲突" });
  await expect(dialog).toBeVisible();
  await b.getByLabel("文章标题").fill("B再次标题");
  await save(b);
  await expect(b.getByRole("status")).toContainText("草稿已保存");
  await dialog
    .getByRole("button", { name: "保留我的版本", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("文章标题")).toHaveValue("A本地标题");
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/posts/${post.id}`)).json()).post.title,
    )
    .toBe("B再次标题");
  await b.close();
});
