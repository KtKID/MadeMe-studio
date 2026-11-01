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

for (const [choice, label] of [
  ["A", "使用我的版本"],
  ["B", "使用服务器版本"],
] as const) {
  test(`@author 选择${choice}：展示两种正文，未选修改放弃且不留副本`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const post = await seed(request, baseURL),
      b = await context.newPage();
    await open(page, post.id);
    await open(b, post.id);
    await page.evaluate(() =>
      localStorage.setItem("mademe:editor-recovery:legacy", "保持原样"),
    );
    await editBody(page, "A窗口未保存的整篇正文");
    await editBody(b, "B窗口已保存的整篇正文");
    await save(b);
    await expect(b.getByRole("status")).toContainText("草稿已保存");
    await save(page);
    const dialog = page.getByRole("dialog", { name: "处理版本冲突" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("region", { name: "A · 本地" }),
    ).toContainText("A窗口未保存的整篇正文");
    await expect(
      dialog.getByRole("region", { name: "B · 服务器" }),
    ).toContainText("B窗口已保存的整篇正文");
    if (choice === "A" && process.env.CONFLICT_SCREENSHOT_DIR) {
      const directory = process.env.CONFLICT_SCREENSHOT_DIR;
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, "desktop-ab.png") });
      await page.setViewportSize({ width: 412, height: 915 });
      await expect
        .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
        .toBe(true);
      await page.screenshot({ path: join(directory, "mobile-ab.png") });
    }
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const selected =
      choice === "A" ? "A窗口未保存的整篇正文" : "B窗口已保存的整篇正文";
    await expect(body(page)).toContainText(selected);
    const final = (await (await request.get(`/api/posts/${post.id}`)).json())
      .post;
    expect(JSON.stringify(final.blocks)).toContain(selected);
    expect(JSON.stringify(final.blocks)).not.toContain(
      choice === "A" ? "B窗口已保存的整篇正文" : "A窗口未保存的整篇正文",
    );
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("mademe:editor-recovery:"),
        ),
      ),
    ).toEqual(["mademe:editor-recovery:legacy"]);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("mademe:editor-recovery:legacy"),
      ),
    ).toBe("保持原样");
    await page.reload();
    await expect(body(page)).toContainText(selected);
    await expect(
      page.getByRole("button", { name: "本地副本", exact: true }),
    ).toHaveCount(0);
    await b.close();
  });
  test(`@author ${choice}确认请求期间服务器再次更新，重新展示且不覆盖`, async ({
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
    let release!: () => void, arrive!: () => void;
    const waiting = new Promise<void>((r) => (release = r)),
      arrived = new Promise<void>((r) => (arrive = r));
    let held = false;
    await page.route(`**/api/posts/${post.id}`, async (route) => {
      if (
        !held &&
        route.request().method() === (choice === "A" ? "PATCH" : "GET")
      ) {
        held = true;
        arrive();
        await waiting;
      }
      await route.continue();
    });
    try {
      await dialog.getByRole("button", { name: label, exact: true }).click();
      await arrived;
      await b.getByLabel("文章标题").fill("B再次更新的标题");
      await save(b);
      await expect(b.getByRole("status")).toContainText("草稿已保存");
      release();
      await expect(
        dialog.getByRole("region", { name: "B · 服务器" }),
      ).toContainText("B再次更新的标题");
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("文章标题")).toHaveValue("A本地标题");
      expect(
        (await (await request.get(`/api/posts/${post.id}`)).json()).post.title,
      ).toBe("B再次更新的标题");
    } finally {
      release?.();
      await b.close();
    }
  });
  test(`@author ${choice}选择网络失败，不丢输入或显示成功`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const post = await seed(request, baseURL),
      b = await context.newPage();
    await open(page, post.id);
    await open(b, post.id);
    await editBody(page, "本地网络失败不可丢");
    await editBody(b, "服务器已保存正文");
    await save(b);
    await expect(b.getByRole("status")).toContainText("草稿已保存");
    await save(page);
    const dialog = page.getByRole("dialog", { name: "处理版本冲突" });
    await expect(dialog).toBeVisible();
    let aborted = false;
    await page.route(`**/api/posts/${post.id}`, async (route) => {
      if (
        !aborted &&
        route.request().method() === (choice === "A" ? "PATCH" : "GET")
      ) {
        aborted = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("网络");
    await expect(
      dialog.getByRole("region", { name: "A · 本地" }),
    ).toContainText("本地网络失败不可丢");
    expect(
      JSON.stringify(
        (await (await request.get(`/api/posts/${post.id}`)).json()).post.blocks,
      ),
    ).toContain("服务器已保存正文");
    await b.close();
  });
}
