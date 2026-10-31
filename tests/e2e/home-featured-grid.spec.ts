import { test, expect, devices, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { postSchema, type Post } from "../../src/shared/contracts";

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const heading of await page.locator(".home-post h2").all()) {
    expect(
      await heading.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
}

test("@author 刊物：首页三篇主次、四列顺序、窄屏、明暗及边界", async ({
  page,
  request,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(60_000);
  const origin = new URL(baseURL!).origin;
  const info = await (await request.get("/api/bootstrap")).json();
  expect(info.capabilities?.authenticated, "必须在显式测试作者实例运行").toBe(
    true,
  );
  expect(info.posts, "必须使用空的隔离数据库").toHaveLength(0);
  const posts: Post[] = [];
  const screenshotDir =
    process.env.HOME_SCREENSHOT_DIR || testInfo.outputPath("screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const screenshot = async (name: string) => {
    await page.getByRole("searchbox").blur();
    await page.screenshot({ path: join(screenshotDir, name), fullPage: true });
  };
  try {
    await page.goto("/");
    await expect(page.getByText("好故事，正在酝酿")).toBeVisible();
    await noOverflow(page);
    // Canvas 生成可解码的测试封面，上传到本次临时 R2；不依赖外部图片服务。
    const pngs = await page.evaluate(() =>
      ["#dfcca2", "#bcccb6", "#c5ced5", "#e1c3b1"].map((background, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 675;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, 1200, 675);
        ctx.strokeStyle = "#505443";
        ctx.lineWidth = 3;
        for (let i = 0; i < 7; i++) {
          ctx.beginPath();
          ctx.arc(820, 330, 80 + i * 38, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = "#505443";
        ctx.fillRect(180, 230, 180, 180);
        ctx.font = "24px sans-serif";
        ctx.fillText(`MADEME / JOURNAL 0${index + 1}`, 70, 90);
        return canvas.toDataURL("image/png").split(",")[1];
      }),
    );
    const covers: string[] = [];
    for (const [index, png] of pngs.entries()) {
      const response = await request.post("/api/media", {
        headers: { Origin: origin },
        multipart: {
          file: {
            name: `E2E-home-${index}.png`,
            mimeType: "image/png",
            buffer: Buffer.from(png, "base64"),
          },
        },
      });
      expect(response.status()).toBe(201);
      covers.push((await response.json()).media.url);
    }
    const titles = [
      "把想法留下，让日常生长",
      "步履之间，发现城市的另一面",
      "步履不停，也给自己一点留白",
      "用文字整理生活",
      "与一本书慢慢相处",
      "周末的山野来信",
      "从一个小问题开始思考",
      "让工具回到创作本身",
      "那些值得被记住的片刻",
      "在日常中寻找新的视角",
      "用 AI 重新理解自己的工作与创造力",
    ];
    for (const [index, title] of titles.entries()) {
      const created = await request.post("/api/posts", {
        headers: { Origin: origin },
        data: {
          title,
          excerpt:
            "记录那些一闪而过的念头，也分享沿途看见的风景。每一次落笔，都让想法更清晰一点。",
          category: index % 2 ? "思考" : "随笔",
          tags: ["E2E首页"],
          pinned: index === 0,
          coverImage:
            index === 4 || index === 7 ? "" : covers[index % covers.length],
          blocks: [],
        },
      });
      expect(created.status()).toBe(201);
      const draft = postSchema.parse((await created.json()).post);
      const published = await request.post(`/api/posts/${draft.id}/publish`, {
        headers: { Origin: origin },
        data: { version: draft.version, visibility: "public" },
      });
      expect(published.ok()).toBe(true);
      posts.push(postSchema.parse((await published.json()).post));
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/");
    await expect(page.locator(".home-post")).toHaveCount(11);
    await expect
      .poll(() =>
        page
          .locator(".home-post img")
          .evaluateAll((images) =>
            images.every(
              (img) =>
                (img as HTMLImageElement).naturalWidth > 0 &&
                /\/(480|960)\.webp$/.test((img as HTMLImageElement).currentSrc),
            ),
          ),
      )
      .toBe(true);
    // 等待 React 岛完成初始化；搜索真实交互同时验证标签搜索仍有效。
    await page.getByRole("searchbox").fill("E2E首页");
    await expect(page.locator(".home-post")).toHaveCount(11);
    const featured = page.getByRole("region", { name: "重点文章" });
    await expect(featured.locator("h2").first()).toHaveText(titles[0]);
    const boxes = await featured.locator("article").evaluateAll((cards) =>
      cards.map((card) => {
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(boxes[0].width).toBeGreaterThan(boxes[1].width * 1.5);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(Math.abs(boxes[1].x - boxes[2].x)).toBeLessThan(1);
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
    const grid = await page
      .locator(".home-post-grid article")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const r = card.getBoundingClientRect();
          return { x: r.x, y: r.y };
        }),
      );
    expect(grid.slice(0, 4).every((r) => Math.abs(r.y - grid[0].y) < 1)).toBe(
      true,
    );
    expect(
      grid[0].x < grid[1].x && grid[1].x < grid[2].x && grid[2].x < grid[3].x,
    ).toBe(true);
    expect(grid[4].y).toBeGreaterThan(grid[0].y);
    expect(Math.abs(grid[4].x - grid[0].x)).toBeLessThan(1);
    await page.getByRole("searchbox").clear();
    await page.evaluate(() => {
      document.documentElement.dataset.mode = "light";
    });
    await noOverflow(page);
    await screenshot("home-desktop-light.png");
    const lightColor = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.evaluate(() => {
      document.documentElement.dataset.mode = "dark";
    });
    await expect
      .poll(() => page.locator("html").getAttribute("data-color-mode"))
      .toBe("dark");
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe(lightColor);
    await screenshot("home-desktop-dark.png");
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      const count = await page
        .locator(".home-post-grid")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      expect(count).toBe(width === 320 ? 1 : 2);
      if (width === 768) await screenshot("home-tablet-dark.png");
      if (width === 390) {
        const covers = await featured
          .locator(".article-card-visual")
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().width),
          );
        expect(covers[0]).toBeGreaterThan(covers[1] * 2);
        await screenshot("home-mobile-dark.png");
        await page.evaluate(() => {
          document.documentElement.dataset.mode = "light";
        });
        await expect
          .poll(() => page.locator("html").getAttribute("data-color-mode"))
          .toBe("light");
        await screenshot("home-mobile-light.png");
      }
    }
    const android = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL,
      colorScheme: "light",
    });
    try {
      const mobile = await android.newPage();
      await mobile.goto("/");
      await expect(mobile.locator(".home-post")).toHaveCount(11);
      expect(
        await mobile.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      await noOverflow(mobile);
      await mobile.screenshot({
        path: join(screenshotDir, "home-android-light.png"),
        fullPage: true,
      });
      await mobile.emulateMedia({ colorScheme: "dark" });
      await expect
        .poll(() => mobile.locator("html").getAttribute("data-color-mode"))
        .toBe("dark");
      await mobile.screenshot({
        path: join(screenshotDir, "home-android-dark.png"),
        fullPage: true,
      });
    } finally {
      await android.close();
    }
    for (const [query, count] of [
      ["步履", 2],
      [titles[0], 1],
      ["不存在的测试文字", 0],
    ] as const) {
      await page.getByRole("searchbox").fill(query);
      await expect(page.locator(".home-post")).toHaveCount(count);
      await expect(page.locator(".home-more")).toHaveCount(0);
      if (!count)
        await expect(page.getByText("没有找到相关文字")).toBeVisible();
      await noOverflow(page);
    }
    // 长中文/连续英文在桌面及窄屏都完整换行，不截掉标题或撑宽页面。
    const last = posts.at(-1)!;
    const updated = await request.patch(`/api/posts/${last.id}`, {
      headers: { Origin: origin },
      data: {
        version: last.version,
        title: "长标题边界".repeat(10) + "UnbrokenTitle".repeat(5),
      },
    });
    expect(updated.ok()).toBe(true);
    const changed = postSchema.parse((await updated.json()).post);
    const republished = await request.post(`/api/posts/${last.id}/publish`, {
      headers: { Origin: origin },
      data: { version: changed.version, visibility: "public" },
    });
    expect(republished.ok()).toBe(true);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await expect(
        page.locator(".home-post h2").filter({ hasText: "UnbrokenTitle" }),
      ).toBeVisible();
      await noOverflow(page);
    }
    // 不执行 JS 的访客仍能读取两区、封面及真实文章链接。
    const staticContext = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
    });
    try {
      const staticPage = await staticContext.newPage();
      await staticPage.goto("/");
      await expect(staticPage.locator(".home-post")).toHaveCount(11);
      await staticPage.locator(".home-post-link").first().click();
      await expect(staticPage.locator("h1")).toHaveText(titles[0]);
    } finally {
      await staticContext.close();
    }
  } finally {
    for (const post of posts) {
      const response = await request.get(`/api/posts/${post.id}`);
      if (response.ok()) {
        const latest = postSchema.parse((await response.json()).post);
        const removed = await request.delete(`/api/posts/${post.id}`, {
          headers: { Origin: origin },
          data: { version: latest.version },
        });
        expect(removed.ok()).toBe(true);
      }
    }
  }
});
