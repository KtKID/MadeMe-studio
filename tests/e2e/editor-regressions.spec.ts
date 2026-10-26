import { test, expect, type APIRequestContext } from "@playwright/test";
import { postSchema } from "../../src/shared/contracts";
async function fixture(
  request: APIRequestContext,
  baseURL: string | undefined,
) {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(
    bootstrap.capabilities?.authenticated,
    "作者用例必须配置显式本机作者身份，禁止 skip 伪通过",
  ).toBe(true);
  const response = await request.post("/api/posts", {
    headers: { Origin: new URL(baseURL!).origin },
    data: {
      title: `E2E regression ${Date.now()}`,
      blocks: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "唯一一段不可丢失的文字", styles: {} },
          ],
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  return postSchema.parse((await response.json()).post);
}
async function cleanup(
  request: APIRequestContext,
  baseURL: string | undefined,
  id: string,
) {
  const response = await request.get(`/api/posts/${id}`);
  if (!response.ok()) return;
  const { post } = await response.json();
  if (!post.deletedAt)
    await request.delete(`/api/posts/${id}`, {
      headers: { Origin: new URL(baseURL!).origin },
      data: { version: post.version },
    });
}
test("@author 回归：延迟 PATCH 中输入的新标题被保留且仍未保存", async ({
  page,
  request,
  baseURL,
}) => {
  const post = await fixture(request, baseURL);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((r) => {
    release = r;
  });
  const arrived = new Promise<void>((r) => {
    started = r;
  });
  try {
    await page.goto(`/studio/edit?id=${post.id}`);
    await page.getByLabel("文章标题").fill("正在保存的旧标题");
    await page.route(`**/api/posts/${post.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      started();
      await waiting;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await arrived;
    await page.getByLabel("文章标题").fill("保存等待时继续输入的新标题");
    release();
    await expect(page.getByRole("status")).toContainText("仍未保存");
    await expect(page.getByLabel("文章标题")).toHaveValue(
      "保存等待时继续输入的新标题",
    );
    await expect(page.locator(".save-status")).toContainText("有未保存修改");
    const saved = await (await request.get(`/api/posts/${post.id}`)).json();
    expect(saved.post.title).toBe("正在保存的旧标题");
  } finally {
    release?.();
    await cleanup(request, baseURL, post.id);
  }
});
test("@author 回归：单段 Markdown 导入取消后原文不变", async ({
  page,
  request,
  baseURL,
}) => {
  const post = await fixture(request, baseURL);
  try {
    await page.goto(`/studio/edit?id=${post.id}`);
    await expect(page.locator(".bn-editor")).toContainText(
      "唯一一段不可丢失的文字",
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .locator('input[type="file"][accept*=".markdown"]')
      .setInputFiles({
        name: "replacement.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# 不应被导入\n\n替换文字"),
      });
    await expect(page.locator(".bn-editor")).toContainText(
      "唯一一段不可丢失的文字",
    );
    await expect(page.locator(".bn-editor")).not.toContainText("替换文字");
  } finally {
    await cleanup(request, baseURL, post.id);
  }
});
test("@author 回归：首页只读发布快照，原地发布返回后看到新快照", async ({
  page,
  request,
  baseURL,
}) => {
  const post = await fixture(request, baseURL);
  const headers = { Origin: new URL(baseURL!).origin };
  try {
    const published = postSchema.parse(
      (
        await (
          await request.post(`/api/posts/${post.id}/publish`, {
            headers,
            data: { version: post.version, visibility: "public" },
          })
        ).json()
      ).post,
    );
    await request.patch(`/api/posts/${post.id}`, {
      headers,
      data: { version: published.version, title: `未发布标题 ${post.id}` },
    });
    await page.goto("/");
    await expect(
      page.locator(".article-card").filter({ hasText: post.title }),
    ).toBeVisible();
    await expect(page.locator(".article-card")).not.toContainText(
      `未发布标题 ${post.id}`,
    );
    await page.goto(`/p/${published.slug}`);
    await page.getByRole("button", { name: "编辑这篇文章" }).click();
    await page.getByLabel("文章标题").fill(`新发布标题 ${post.id}`);
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已发布。");
    await page.getByRole("button", { name: "返回阅读" }).click();
    await expect(page.locator("#article-reading h1")).toHaveText(
      `新发布标题 ${post.id}`,
    );
  } finally {
    await cleanup(request, baseURL, post.id);
  }
});
test("@author 撤下公开版本明确确认并保留草稿", async ({
  page,
  request,
  baseURL,
}) => {
  const post = await fixture(request, baseURL);
  try {
    await request.post(`/api/posts/${post.id}/publish`, {
      headers: { Origin: new URL(baseURL!).origin },
      data: { version: post.version, visibility: "public" },
    });
    await page.goto(`/studio/edit?id=${post.id}`);
    await page.getByTitle("文章设置").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "撤下已发布版本", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("已撤下公开版本");
    const result = await (await request.get(`/api/posts/${post.id}`)).json();
    expect(result.post.publishedAt).toBeNull();
    expect(result.post.blocks.length).toBeGreaterThan(0);
  } finally {
    await cleanup(request, baseURL, post.id);
  }
});
