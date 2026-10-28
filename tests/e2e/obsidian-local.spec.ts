import {
  test,
  expect,
  type APIRequestContext,
  type Download,
} from "@playwright/test";

// 仅在隔离作者实例运行；不创建服务器文章、不读取用户目录。
async function requireAuthor(request: APIRequestContext) {
  const response = await request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(
    data.capabilities?.authenticated,
    "本地导出 E2E 必须配置显式测试作者身份，不能 skip 伪通过",
  ).toBe(true);
}
async function downloadContents(download: Download) {
  const stream = await download.createReadStream();
  expect(stream, "浏览器下载必须实际产生可读内容").not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("@author 本地导出：不支持目录授权时下载当前未保存稿，不伪报同步", async ({
  page,
  request,
}) => {
  await requireAuthor(request);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/(posts|settings)(?:\/|$|\?)/.test(request.url()) &&
      ["POST", "PATCH", "DELETE"].includes(request.method())
    )
      writes.push(request.method());
  });
  await page.goto("/studio/new");
  await page.getByLabel("文章标题").fill("E2E 当前未保存本地标题");
  const body = page
    .locator(
      '.bn-editor [contenteditable="true"],.bn-editor[contenteditable="true"]',
    )
    .first();
  await expect(body).toBeVisible();
  await body.click();
  await page.keyboard.type("仅在当前编辑器中的最新正文");
  await page
    .getByRole("button", { name: "保存到 Obsidian", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "保存到 Obsidian" });
  await expect(dialog).toContainText("不代表图片已落盘或已同步 Obsidian");
  const downloading = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "仅下载 Markdown", exact: true })
    .click();
  const markdown = await downloadContents(await downloading);
  expect(markdown).toContain("# E2E 当前未保存本地标题");
  expect(markdown).toContain("仅在当前编辑器中的最新正文");
  await expect(dialog).not.toContainText("已保存到本地 Obsidian 仓库");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("文章标题")).toHaveValue(
    "E2E 当前未保存本地标题",
  );
  expect(writes).toEqual([]);
});

test("@author 本地预设：取消目录选择不保存预设且不 PATCH 站点设置", async ({
  page,
  request,
}) => {
  await requireAuthor(request);
  await page.addInitScript(() => {
    // 仅模拟浏览器的取消结果，不是原生目录授权验收。
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        throw new DOMException("用户取消", "AbortError");
      },
    });
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/settings(?:$|\?)/.test(request.url()) &&
      request.method() === "PATCH"
    )
      writes.push(request.url());
  });
  await page.goto("/studio/settings");
  await page
    .getByRole("button", { name: "同步 Obsidian", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "同步 Obsidian", exact: true }),
  ).toBeVisible();
  await page.getByLabel("预设名称", { exact: true }).fill("E2E 未授权预设");
  await expect(page.getByLabel("默认文章子目录", { exact: true })).toHaveValue(
    "笔记",
  );
  await expect(
    page.getByLabel("图片规则（相对文章目录）", { exact: true }),
  ).toHaveValue("../asset");
  await page
    .getByRole("button", { name: "浏览选择 vault 根目录", exact: true })
    .click();
  await expect(
    page.getByText("已取消目录选择，原预设未改变。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存本地预设", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("本地预设已保存，仅此浏览器可用。", { exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("@author 本地导出：选择其他位置取消后停止并保留当前稿", async ({
  page,
  request,
}) => {
  await requireAuthor(request);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        throw new DOMException("用户取消", "AbortError");
      },
    });
  });
  await page.goto("/studio/new");
  await page.getByLabel("文章标题").fill("取消授权不能丢失的标题");
  await page
    .getByRole("button", { name: "保存到 Obsidian", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "保存到 Obsidian" });
  await dialog
    .getByRole("button", { name: "选择其他位置", exact: true })
    .click();
  await expect(dialog).toContainText("已取消选择，未保存文件。");
  await expect(
    dialog.getByRole("button", { name: "保存本次快照", exact: true }),
  ).toBeDisabled();
  await expect(dialog).not.toContainText("已保存到本地 Obsidian 仓库");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("文章标题")).toHaveValue(
    "取消授权不能丢失的标题",
  );
});
