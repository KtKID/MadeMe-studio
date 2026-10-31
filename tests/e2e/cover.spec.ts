import { test, expect, type Page, type Locator } from "@playwright/test";
// 封面比例与展示设置浏览器验收（模拟数据，非真实生图）：
// Canvas 生成带四边色带、四角黑块与文字的测试图，按像素检查完整显示不丢边、裁切位置可控、白底补边、最大 1024。
const SHOTS = process.env.COVER_SHOTS_DIR || "test-results/cover-shots";
const COLORS = {
  red: [255, 0, 0],
  blue: [0, 0, 255],
  magenta: [255, 0, 255],
  green: [0, 192, 0],
  white: [255, 255, 255],
} as const;
type Color = keyof typeof COLORS;
type Settings = {
  aspect: "original" | "1:1" | "4:3" | "16:9";
  fit: "contain" | "cover";
  focusX: number;
  focusY: number;
  zoom: number;
};
const RATIO = { "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9 } as const;
const marker = `E2E-cover-${Date.now()}`;

async function requireAuthor(page: Page) {
  const data = await (await page.request.get("/api/bootstrap")).json();
  expect(data.capabilities?.authenticated, "封面验收需要显式测试作者身份").toBe(
    true,
  );
}
/** 上传一张带边缘标记的 PNG，返回媒体 URL。 */
async function uploadMarkerImage(page: Page, width: number, height: number) {
  return page.evaluate(
    async ({ width, height, name }) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      const band = Math.round(Math.min(width, height) * 0.06);
      ctx.fillStyle = "#d9d9d9";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, band, height);
      ctx.fillStyle = "#00c000";
      ctx.fillRect(width - band, 0, band, height);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, width, band);
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(0, height - band, width, band);
      ctx.fillStyle = "#000";
      for (const [x, y] of [
        [0, 0],
        [width - band * 2, 0],
        [0, height - band * 2],
        [width - band * 2, height - band * 2],
      ])
        ctx.fillRect(x, y, band * 2, band * 2);
      ctx.font = `bold ${band}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("TOP", width / 2, band * 2.2);
      ctx.fillText("BOTTOM", width / 2, height - band * 1.4);
      ctx.fillText(`${width}×${height}`, width / 2, height / 2);
      ctx.textAlign = "left";
      ctx.fillText("LEFT", band * 1.3, height / 2 + band * 1.5);
      ctx.textAlign = "right";
      ctx.fillText("RIGHT", width - band * 1.3, height / 2 + band * 1.5);
      const blob: Blob = await new Promise((r) =>
        c.toBlob((b) => r(b!), "image/png"),
      );
      const form = new FormData();
      form.append("file", new File([blob], name, { type: "image/png" }));
      const res = await fetch("/api/media", { method: "POST", body: form });
      if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
      return ((await res.json()) as { media: { url: string } }).media.url;
    },
    { width, height, name: `${marker}-${width}x${height}.png` },
  );
}
async function apiJSON(
  page: Page,
  path: string,
  method: string,
  body: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error(`${method} ${path} ${res.status} ${await res.text()}`);
      return (await res.json()) as any;
    },
    { path, method, body },
  );
}
async function createPublished(
  page: Page,
  title: string,
  coverImage: string,
  coverSettings?: Settings,
) {
  const { post } = await apiJSON(page, "/api/posts", "POST", {
    title,
    blocks: [{ type: "paragraph", content: "封面验收正文" }],
    coverImage,
    ...(coverSettings ? { coverSettings } : {}),
  });
  const published = await apiJSON(
    page,
    `/api/posts/${post.id}/publish`,
    "POST",
    {
      version: post.version,
      visibility: "public",
    },
  );
  return published.post as { id: string; slug: string; version: number };
}
async function loaded(frame: Locator) {
  // 居中滚动，避免吸顶工具栏盖住封面截图。
  await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect
    .poll(() =>
      frame
        .locator("img")
        .first()
        .evaluate(
          (i) =>
            (i as HTMLImageElement).complete &&
            (i as HTMLImageElement).naturalWidth > 0,
        ),
    )
    .toBe(true);
}
/** 截取封面框本身并统计各标记色占比。 */
async function analyze(page: Page, frame: Locator, label = "") {
  await loaded(frame);
  const box = (await frame.boundingBox())!;
  const png = await frame.screenshot(
    label ? { path: `${SHOTS}/frames/${label}.png` } : {},
  );
  const fractions = await page.evaluate(
    async ({ b64, colors }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const counts: Record<string, number> = {};
      for (const k of Object.keys(colors)) counts[k] = 0;
      for (let i = 0; i < d.length; i += 4)
        for (const [k, [r, g, b]] of Object.entries(colors))
          if (
            Math.abs(d[i] - r) +
              Math.abs(d[i + 1] - g) +
              Math.abs(d[i + 2] - b) <
            60
          )
            counts[k]++;
      const total = d.length / 4;
      // 白色补边按整行/整列统计（≥95% 为白），避免把圆角外露出的页面底色算作补边。
      const isWhite = (i: number) =>
        d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245;
      let rows = 0;
      let cols = 0;
      for (let y = 0; y < c.height; y++) {
        let n = 0;
        for (let x = 0; x < c.width; x++)
          if (isWhite((y * c.width + x) * 4)) n++;
        if (n >= c.width * 0.95) rows++;
      }
      for (let x = 0; x < c.width; x++) {
        let n = 0;
        for (let y = 0; y < c.height; y++)
          if (isWhite((y * c.width + x) * 4)) n++;
        if (n >= c.height * 0.95) cols++;
      }
      return {
        ...Object.fromEntries(
          Object.entries(counts).map(([k, v]) => [k, v / total]),
        ),
        white: rows / c.height + cols / c.width,
      };
    },
    { b64: png.toString("base64"), colors: COLORS },
  );
  return { box, fractions: fractions as Record<Color, number> };
}
// white 为整行/整列白色补边的占比，补边至少 3%。
function expectPresence(
  label: string,
  fractions: Record<Color, number>,
  present: Color[],
  absent: Color[],
) {
  for (const c of present)
    expect(fractions[c], `${label}: 应看到 ${c}`).toBeGreaterThan(
      c === "white" ? 0.03 : 0.002,
    );
  for (const c of absent)
    expect
      .soft(fractions[c], `${label}: 不应看到 ${c}`)
      .toBeLessThan(c === "white" ? 0.01 : 0.0005);
}

type Case = {
  name: string;
  size: [number, number];
  settings?: Settings;
  present: Color[];
  absent: Color[];
};
const s = (
  aspect: Settings["aspect"],
  fit: Settings["fit"],
  focusX = 50,
  focusY = 50,
  zoom = 1,
): Settings => ({ aspect, fit, focusX, focusY, zoom });
const EDGES: Color[] = ["red", "blue", "magenta", "green"];
const CASES: Case[] = [
  { name: "旧文章无设置·竖图", size: [900, 1600], present: EDGES, absent: [] },
  {
    name: "原图·竖图",
    size: [900, 1600],
    settings: s("original", "contain"),
    present: EDGES,
    absent: [],
  },
  {
    name: "原图·横图",
    size: [1600, 900],
    settings: s("original", "contain"),
    present: EDGES,
    absent: [],
  },
  {
    name: "1:1完整·横图",
    size: [1600, 900],
    settings: s("1:1", "contain"),
    present: [...EDGES, "white"],
    absent: [],
  },
  {
    name: "4:3完整·竖图",
    size: [900, 1600],
    settings: s("4:3", "contain"),
    present: [...EDGES, "white"],
    absent: [],
  },
  {
    name: "16:9完整·方图",
    size: [1000, 1000],
    settings: s("16:9", "contain"),
    present: [...EDGES, "white"],
    absent: [],
  },
  {
    name: "1:1裁切顶部·竖图",
    size: [900, 1600],
    settings: s("1:1", "cover", 50, 0),
    present: ["red", "magenta", "green"],
    absent: ["blue", "white"],
  },
  {
    name: "16:9裁切底部·竖图",
    size: [900, 1600],
    settings: s("16:9", "cover", 50, 100),
    present: ["blue", "magenta", "green"],
    absent: ["red", "white"],
  },
  {
    name: "4:3裁切左侧·横图",
    size: [1600, 900],
    settings: s("4:3", "cover", 0, 50),
    present: ["magenta", "red", "blue"],
    absent: ["green", "white"],
  },
  {
    name: "1:1放大2倍左上·方图",
    size: [1000, 1000],
    settings: s("1:1", "cover", 0, 0, 2),
    present: ["red", "magenta"],
    absent: ["blue", "green", "white"],
  },
];

function checkGeometry(
  label: string,
  c: Case,
  box: { width: number; height: number },
) {
  expect(box.width, `${label} 宽不超过 1024`).toBeLessThanOrEqual(1024.5);
  expect(box.height, `${label} 高不超过 1024`).toBeLessThanOrEqual(1024.5);
  const aspect = c.settings?.aspect ?? "original";
  const expected =
    aspect === "original" ? c.size[0] / c.size[1] : RATIO[aspect];
  expect(
    Math.abs(box.width / box.height - expected),
    `${label} 比例`,
  ).toBeLessThan(0.03);
}

test.describe.configure({ mode: "serial" });
const created: { c: Case; title: string; slug: string; id: string }[] = [];

test("@author 封面：准备测试图与文章（全部比例 × 展示方式）", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await requireAuthor(page);
  const urls = new Map<string, string>();
  for (const c of CASES) {
    const key = c.size.join("x");
    if (!urls.has(key)) urls.set(key, await uploadMarkerImage(page, ...c.size));
    const title = `${marker} ${c.name}`;
    const post = await createPublished(page, title, urls.get(key)!, c.settings);
    created.push({ c, title, slug: post.slug, id: post.id });
  }
  expect(created).toHaveLength(CASES.length);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 1400 },
  { name: "390", width: 390, height: 844 },
]) {
  test(`@author 封面：首页、文章页、编辑器一致（${viewport.name}）`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.screenshot({
      path: `${SHOTS}/${viewport.name}-home.png`,
      fullPage: true,
    });
    const bodies = new Set<string>();
    for (const { c, title } of created) {
      const card = page.locator(".article-card", {
        has: page.getByRole("heading", { name: title, exact: true }),
      });
      const frame = card.locator(".cover-frame");
      const { box, fractions } = await analyze(
        page,
        frame,
        `${viewport.name}-home-${c.name}`,
      );
      checkGeometry(`首页 ${c.name}`, c, box);
      expectPresence(`首页 ${c.name}`, fractions, c.present, c.absent);
      bodies.add(
        await card
          .locator(".article-card-body h2")
          .evaluate((h) => getComputedStyle(h).fontSize),
      );
    }
    // 卡片封面高度可以不同，但同一版位的文字排版一致：默认刊物布局（HomeFeaturedPosts）
    // 有主篇 / 次篇 / 普通网格三种标题字号，其余布局为 featured / 普通两种。
    expect(bodies.size).toBeLessThanOrEqual(3);
    for (const [index, { c, slug, title }] of created.entries()) {
      await page.goto(`/p/${slug}`);
      const frame = page.locator(".reading-cover .cover-frame");
      const { box, fractions } = await analyze(
        page,
        frame,
        `${viewport.name}-article-${c.name}`,
      );
      checkGeometry(`文章页 ${c.name}`, c, box);
      expectPresence(`文章页 ${c.name}`, fractions, c.present, c.absent);
      if (index === 0 || index === 6)
        await page.screenshot({
          path: `${SHOTS}/${viewport.name}-article-${index}.png`,
          fullPage: false,
        });
      expect(title).toBeTruthy();
    }
    for (const [index, { c, id }] of created.entries()) {
      await page.goto(`/studio/edit?id=${id}`);
      const frame = page.locator(".editor-cover .cover-frame");
      const { box, fractions } = await analyze(
        page,
        frame,
        `${viewport.name}-editor-${c.name}`,
      );
      checkGeometry(`编辑器 ${c.name}`, c, box);
      expectPresence(`编辑器 ${c.name}`, fractions, c.present, c.absent);
      if (index === 6)
        await page.screenshot({ path: `${SHOTS}/${viewport.name}-editor.png` });
    }
    await page.goto("/studio");
    for (const { c, title } of created) {
      const row = page.locator(".post-row", { hasText: title });
      const thumb = row.locator(".post-thumb .cover-frame");
      const { box, fractions } = await analyze(
        page,
        thumb,
        `${viewport.name}-studio-${c.name}`,
      );
      expect(box.width, `工作台缩略图 ${c.name} 可见`).toBeGreaterThan(8);
      expect(box.height, `工作台缩略图 ${c.name} 可见`).toBeGreaterThan(8);
      // 缩略图只是同一封面等比缩小：比例与可见色带与大图一致。
      const aspect = c.settings?.aspect ?? "original";
      const expected =
        aspect === "original" ? c.size[0] / c.size[1] : RATIO[aspect];
      expect(
        Math.abs(box.width / box.height - expected),
        `工作台缩略图 ${c.name} 比例`,
      ).toBeLessThan(0.12);
      expectPresence(
        `工作台缩略图 ${c.name}`,
        fractions,
        c.present.filter((x) => x !== "white"),
        c.absent.filter((x) => x !== "white"),
      );
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${SHOTS}/${viewport.name}-studio-thumbs.png`,
    });
  });
}

test("@author 封面：调整→取消→应用→保存→重载→发布面板改比例→发布→再改→重新发布", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/");
  await requireAuthor(page);
  const url = await uploadMarkerImage(page, 900, 1600);
  const title = `${marker} 流程`;
  const post = await createPublished(page, title, url);
  await page.goto(`/studio/edit?id=${post.id}`);
  const frame = page.locator(".editor-cover .cover-frame");
  await expect(frame).toHaveAttribute("data-aspect", "original");
  await expect(frame).toHaveAttribute("data-fit", "contain");

  await page.getByRole("button", { name: "调整封面" }).click();
  let dialog = page.getByRole("dialog", { name: "调整封面 · 保留原图" });
  await dialog.getByRole("radio", { name: "正方形 1:1" }).click();
  await dialog.getByRole("radio", { name: "铺满裁切" }).click();
  const area = dialog.getByLabel("拖动或用方向键调整保留区域");
  await expect(dialog.getByTestId("cover-kept-region")).toBeVisible();
  const before = (await dialog.getByTestId("cover-kept-region").boundingBox())!;
  const areaBox = (await area.boundingBox())!;
  await page.mouse.move(
    areaBox.x + areaBox.width / 2,
    areaBox.y + areaBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(areaBox.x + areaBox.width / 2, areaBox.y - 400, {
    steps: 8,
  });
  await page.mouse.up();
  const after = (await dialog.getByTestId("cover-kept-region").boundingBox())!;
  expect(after.y).toBeLessThan(before.y);
  await page.screenshot({ path: `${SHOTS}/1440-adjust-dialog.png` });
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await expect(frame).toHaveAttribute("data-aspect", "original");

  await page.getByRole("button", { name: "调整封面" }).click();
  dialog = page.getByRole("dialog", { name: "调整封面 · 保留原图" });
  await dialog.getByRole("radio", { name: "正方形 1:1" }).click();
  await dialog.getByRole("radio", { name: "铺满裁切" }).click();
  await dialog.getByLabel("拖动或用方向键调整保留区域").focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowUp");
  await dialog.getByRole("button", { name: "应用" }).click();
  await expect(frame).toHaveAttribute("data-aspect", "1:1");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "草稿已保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(frame).toHaveAttribute("data-aspect", "1:1");
  await expect(frame).toHaveAttribute("data-fit", "cover");
  let result = await analyze(page, frame, "flow-1-editor-reload-1x1-top");
  expectPresence(
    "重载后 1:1 顶部",
    result.fractions,
    ["red"],
    ["blue", "white"],
  );
  // 草稿改动不影响线上快照。
  await page.goto(`/p/${post.slug}`);
  await expect(page.locator(".reading-cover .cover-frame")).toHaveAttribute(
    "data-aspect",
    "original",
  );

  await page.goto(`/studio/edit?id=${post.id}`);
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const publish = page.getByRole("dialog");
  const section = publish.getByRole("group", { name: "封面" });
  await section.getByRole("radio", { name: "宽屏 16:9" }).click();
  await expect(
    section.getByRole("group", { name: "实时预览" }).locator(".cover-frame"),
  ).toHaveAttribute("data-aspect", "16:9");
  await page.screenshot({ path: `${SHOTS}/1440-publish-panel.png` });
  await publish.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已发布" }),
  ).toBeVisible();
  await page.goto(`/p/${post.slug}`);
  const reading = page.locator(".reading-cover .cover-frame");
  await expect(reading).toHaveAttribute("data-aspect", "16:9");
  result = await analyze(page, reading, "flow-2-article-published-16x9-top");
  expectPresence(
    "发布后 16:9 顶部",
    result.fractions,
    ["red"],
    ["blue", "white"],
  );
  await page.goto("/");
  await expect(
    page
      .locator(".article-card", {
        has: page.getByRole("heading", { name: title, exact: true }),
      })
      .locator(".cover-frame"),
  ).toHaveAttribute("data-aspect", "16:9");

  await page.goto(`/studio/edit?id=${post.id}`);
  await page.getByRole("button", { name: "调整封面" }).click();
  dialog = page.getByRole("dialog", { name: "调整封面 · 保留原图" });
  await dialog.getByRole("radio", { name: "标准横版 4:3" }).click();
  await dialog.getByRole("radio", { name: "完整显示" }).click();
  await dialog.getByRole("button", { name: "应用" }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "草稿已保存" }),
  ).toBeVisible();
  await page.goto(`/p/${post.slug}`);
  await expect(reading).toHaveAttribute("data-aspect", "16:9");
  await page.goto(`/studio/edit?id=${post.id}`);
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认发布", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已发布" }),
  ).toBeVisible();
  await page.goto(`/p/${post.slug}`);
  await expect(reading).toHaveAttribute("data-aspect", "4:3");
  result = await analyze(
    page,
    reading,
    "flow-3-article-republished-4x3-contain",
  );
  expectPresence(
    "重新发布 4:3 完整",
    result.fractions,
    [...EDGES, "white"],
    [],
  );
});

test("@author 封面：窄屏发布面板与调整弹窗", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { id } = created.find(
    (x) => x.c.settings?.aspect === "1:1" && x.c.settings.fit === "cover",
  )!;
  await page.goto(`/studio/edit?id=${id}`);
  await page.getByRole("button", { name: "调整封面" }).click();
  await page.screenshot({ path: `${SHOTS}/390-adjust-dialog.png` });
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/390-publish-panel.png` });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
