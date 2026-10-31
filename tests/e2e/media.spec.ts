import { test, expect } from "@playwright/test";
// 用浏览器Canvas编码真实PNG，验收解码与输出尺寸，不以文件头魔数假装有效图片。
test("@author 媒体：有效PNG上传解码、裁剪保留原图、输出尺寸正确", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/api/bootstrap")).json();
  expect(info.capabilities?.authenticated, "媒体验收需要显式测试作者身份").toBe(
    true,
  );
  await page.goto("/studio/media");
  await expect(page.locator("[data-studio-ready=true]")).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d4a72c";
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = "#293128";
    ctx.fillRect(50, 50, 250, 150);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const name = `E2E-valid-${Date.now()}.png`;
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const original = page.locator(".media-card").filter({ hasText: name });
  await expect(original).toBeVisible();
  await expect
    .poll(
      async () =>
        await original
          .locator("img")
          .evaluate(
            (image) =>
              (image as HTMLImageElement).naturalWidth > 0 &&
              (image as HTMLImageElement).currentSrc.includes(
                "/images/private/",
              ),
          ),
    )
    .toBe(true);
  await original.getByTitle("裁剪", { exact: true }).click();
  const save = page.getByRole("button", { name: "保存为新图片" });
  await expect(save).toBeEnabled();
  expect(
    await page.locator(".crop-preview canvas").evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    })),
  ).toEqual({ width: 1200, height: 675 });
  await save.click();
  await expect(
    page.getByRole("dialog", { name: "裁剪图片 · 保留原图" }),
  ).not.toBeVisible();
  await expect(original).toBeVisible();
  const cropped = page
    .locator(".media-card")
    .filter({ hasText: `crop-${name.replace(".png", ".jpg")}` });
  await expect(cropped).toBeVisible();
  await expect
    .poll(
      async () =>
        await cropped
          .locator("img")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
  const list = await (await request.get("/api/media")).json();
  const entry = list.media.find((item: { name: string }) => item.name === name);
  expect(entry).toBeTruthy();
  const cropEntry = list.media.find(
    (item: { name: string }) =>
      item.name === `crop-${name.replace(".png", ".jpg")}`,
  );
  expect(cropEntry).toBeTruthy();
  // 缩略图已是衍生图；裁剪输出尺寸必须在实际原文件上检查。
  for (const [url, width, height] of [
    [entry.url, 640, 480],
    [cropEntry.url, 1200, 675],
  ] as const) {
    expect(
      await page.evaluate(async (source) => {
        const bitmap = await createImageBitmap(
          await (await fetch(source)).blob(),
        );
        return { width: bitmap.width, height: bitmap.height };
      }, url),
    ).toEqual({ width, height });
  }
  await page.route(`**${entry.url}`, (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await original.getByTitle("裁剪", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("图片无法读取");
  await expect(save).toBeDisabled();
});
