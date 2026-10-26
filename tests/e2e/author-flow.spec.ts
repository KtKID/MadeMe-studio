import { test, expect } from "@playwright/test";
// 测试仅面向显式开启本机开发身份的隔离环境，不能使用生产账号或真实文章。
test("@author 端到端：真实 BlockNote 草稿、发布快照、原地编辑、回收站恢复", async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const bootstrap = await request.get(`/api/bootstrap`);
  const data = await bootstrap.json();
  expect(
    data.capabilities?.authenticated,
    "作者验收缺少显式测试身份，不能跳过当作通过",
  ).toBe(true);
  const marker = `E2E ${Date.now()}`;
  let id = "";
  try {
    await page.goto(`/studio/new`);
    await page.getByLabel("文章标题").fill(marker);
    const body = page
      .locator(
        '.bn-editor [contenteditable="true"],.bn-editor[contenteditable="true"]',
      )
      .first();
    await expect(body).toBeVisible();
    await body.click();
    await page.keyboard.type("这是一段由端到端测试明确创建的内容。");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "草稿已保存" }),
    ).toBeVisible();
    const list = await (await request.get(`/api/posts`)).json();
    const created = list.posts.find(
      (p: { title: string }) => p.title === marker,
    );
    expect(created).toBeTruthy();
    id = created.id;
    expect(created.publishedAt).toBeNull();
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已发布。" }),
    ).toBeVisible();
    const published = await (await request.get(`/api/posts/${id}`)).json();
    const liveUrl = `/p/${published.post.slug}`;
    await page.goto(liveUrl);
    await expect(page.locator("#article-reading")).toContainText(marker);
    await page.getByRole("button", { name: "编辑这篇文章" }).click();
    await page.getByLabel("文章标题").fill(`${marker} 未发布更改`);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "草稿已保存" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回阅读" }).click();
    await page.reload();
    await expect(page.locator("#article-reading h1")).toHaveText(marker);
    let latest = await (await request.get(`/api/posts/${id}`)).json();
    let deleted = await request.delete(`/api/posts/${id}`, {
      data: { version: latest.post.version },
      headers: { Origin: origin },
    });
    expect(deleted.ok()).toBeTruthy();
    await page.goto(`/studio`);
    await page.getByRole("tab", { name: "回收站" }).click();
    await expect(
      page.getByText(`${marker} 未发布更改`, { exact: true }),
    ).toBeVisible();
    await page
      .locator(".post-row")
      .filter({ hasText: marker })
      .getByTitle("恢复文章")
      .click();
    await page.getByRole("tab", { name: /全部文章/ }).click();
    await expect(
      page.getByText(`${marker} 未发布更改`, { exact: true }),
    ).toBeVisible();
  } finally {
    if (id) {
      const r = await request.get(`/api/posts/${id}`);
      if (r.ok()) {
        const p = await r.json();
        await request.delete(`/api/posts/${id}`, {
          data: { version: p.post.version },
          headers: { Origin: origin },
        });
      }
    }
  }
});
test("@author 冲突：旧版本写入返回 409，服务器保留更新版本", async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const info = await (await request.get(`/api/bootstrap`)).json();
  expect(info.capabilities?.authenticated, "作者验收缺少显式测试身份").toBe(
    true,
  );
  const result = await request.post(`/api/posts`, {
    data: { title: "E2E conflict fixture", blocks: [] },
    headers: { Origin: origin },
  });
  expect(result.ok()).toBeTruthy();
  const { post } = await result.json();
  try {
    const fresh = await request.patch(`/api/posts/${post.id}`, {
      data: { version: post.version, title: "newer" },
      headers: { Origin: origin },
    });
    expect(fresh.ok()).toBeTruthy();
    const stale = await request.patch(`/api/posts/${post.id}`, {
      data: { version: post.version, title: "stale" },
      headers: { Origin: origin },
    });
    expect(stale.status()).toBe(409);
    const latest = await (await request.get(`/api/posts/${post.id}`)).json();
    expect(latest.post.title).toBe("newer");
  } finally {
    const latest = await (await request.get(`/api/posts/${post.id}`)).json();
    await request.delete(`/api/posts/${post.id}`, {
      data: { version: latest.post.version },
      headers: { Origin: origin },
    });
  }
});
