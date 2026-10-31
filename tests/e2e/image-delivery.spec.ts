import { test, expect } from "@playwright/test";
import { postSchema } from "../../src/shared/contracts";

test("@author 原图保留、真实Worker WASM WebP、透明、响应式与撤回鉴权", async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const origin = new URL(baseURL!).origin;
  expect(
    (await (await request.get("/api/bootstrap")).json()).capabilities
      .authenticated,
  ).toBe(true);
  const guest = await playwright.request.newContext({
    baseURL: process.env.SECOND_BASE_URL,
  });
  // 错误签名头通过旧上传签名检查，但绝不能伪装成一次成功的 WebP 转换。
  const broken = Buffer.alloc(24);
  broken.set([137, 80, 78, 71, 13, 10, 26, 10]);
  broken.set([73, 72, 68, 82], 12);
  broken.writeUInt32BE(1536, 16);
  broken.writeUInt32BE(1024, 20);
  const badUpload = await request.post("/api/media", {
    headers: { Origin: origin },
    multipart: {
      file: { name: "E2E-broken.png", mimeType: "image/png", buffer: broken },
    },
  });
  expect(badUpload.status()).toBe(201);
  const bad = (await badUpload.json()).media;
  const badDerivative = await request.get(
    `/api/images/private/v1/${bad.id}/960.webp`,
  );
  expect(badDerivative.status()).toBe(503);
  expect(badDerivative.headers()["cache-control"]).toBe("private, no-store");
  expect(await (await request.get(bad.url)).body()).toEqual(broken);
  await page.goto("/");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1536;
    c.height = 1024;
    const ctx = c.getContext("2d")!;
    const data = ctx.createImageData(c.width, c.height);
    let seed = 12345;
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data.data[i] = seed & 255;
      data.data[i + 1] = (seed >>> 8) & 255;
      data.data[i + 2] = (seed >>> 16) & 255;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    ctx.clearRect(0, 0, 180, 180);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1;
    ctx.strokeRect(200, 200, 900, 500);
    return c.toDataURL("image/png").split(",")[1];
  });
  const input = Buffer.from(png, "base64");
  const upload = await request.post("/api/media", {
    headers: { Origin: origin },
    multipart: {
      file: {
        name: "E2E-image-derivatives.png",
        mimeType: "image/png",
        buffer: input,
      },
    },
  });
  expect(upload.status()).toBe(201);
  const { media } = await upload.json();
  const image = (scope: string, width: number) =>
    `/api/images/${scope}/v1/${media.id}/${width}.webp`;
  expect((await request.get(image("public", 960))).status()).toBe(404);
  expect((await guest.get(image("private", 960))).status()).toBe(404);
  // 首次私有读取已经走真实 Worker WASM 编码，与上传来源无关。
  const privateImage = await request.get(image("private", 960));
  expect(privateImage.status(), await privateImage.text()).toBe(200);
  expect(privateImage.headers()["cache-control"]).toBe("private, no-store");
  expect(await (await request.get(media.url)).body()).toEqual(input);
  const created = await request.post("/api/posts", {
    headers: { Origin: origin },
    data: {
      title: "E2E optimized cover",
      coverImage: media.url,
      markdown: `![Imported body](${media.url})`,
      coverSettings: {
        aspect: "16:9",
        fit: "cover",
        focusX: 20,
        focusY: 80,
        zoom: 1.5,
      },
    },
  });
  expect(created.status()).toBe(201);
  let post = postSchema.parse((await created.json()).post);
  const published = await request.post(`/api/posts/${post.id}/publish`, {
    headers: { Origin: origin },
    data: { version: post.version, visibility: "public" },
  });
  expect(published.status()).toBe(200);
  post = postSchema.parse((await published.json()).post);
  try {
    for (const [width, height] of [
      [960, 640],
      [480, 320],
    ]) {
      const response = await guest.get(image("public", width), {
        headers: { Authorization: "invalid token ignored on public image" },
      });
      expect(response.status(), await response.text()).toBe(200);
      const headers = response.headers();
      expect(headers["content-type"]).toBe("image/webp");
      expect(headers["cache-control"]).toBe(
        "public, max-age=60, s-maxage=0, must-revalidate",
      );
      expect(headers["vary"]).toBeUndefined();
      expect(headers["set-cookie"]).toBeUndefined();
      const output = await response.body();
      expect(output.length).toBeLessThan(input.length);
      const decoded = await page.evaluate(async (b64) => {
        const blob = await (
          await fetch(`data:image/webp;base64,${b64}`)
        ).blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return {
          width: bmp.width,
          height: bmp.height,
          alpha: ctx.getImageData(5, 5, 1, 1).data[3],
        };
      }, output.toString("base64"));
      expect(decoded).toEqual({ width, height, alpha: 0 });
      const conditional = await guest.get(image("public", width), {
        headers: { "If-None-Match": headers.etag },
      });
      expect(conditional.status()).toBe(304);
      const head = await guest.head(image("public", width));
      expect(head.status()).toBe(200);
      expect(head.headers()["content-length"]).toBe(String(output.length));
      console.log(
        JSON.stringify({
          fixture: "synthetic Canvas, not the user image",
          originalBytes: input.length,
          width,
          height,
          webpBytes: output.length,
          quality: 80,
        }),
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${post.slug}`);
    const cover = page.locator(".reading-cover img");
    await expect(page.locator(".reading-prose img")).toHaveAttribute(
      "srcset",
      /images\/public\/.*480\.webp 480w/,
    );
    await expect(cover).toHaveAttribute(
      "srcset",
      /480\.webp 480w.*960\.webp 960w/,
    );
    await expect
      .poll(() =>
        cover.evaluate(
          (el) =>
            (el as HTMLImageElement).complete &&
            (el as HTMLImageElement).naturalWidth > 0 &&
            (el as HTMLImageElement).currentSrc.endsWith("/480.webp"),
        ),
      )
      .toBe(true);
    await expect(page.locator(".reading-cover .cover-frame")).toHaveAttribute(
      "data-aspect",
      "16:9",
    );
    expect(
      await cover.evaluate((el) => (el as HTMLElement).style.objectPosition),
    ).toBe("20% 80%");
    await page.reload();
    // 同源正常浏览器缓存：复访不传输完整展示图。
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some(
              (entry) =>
                entry.name.includes("/images/public/") &&
                (entry as PerformanceResourceTiming).transferSize === 0 &&
                (entry as PerformanceResourceTiming).decodedBodySize > 0,
            ),
        ),
      )
      .toBe(true);
    const withdrawn = await request.post(`/api/posts/${post.id}/unpublish`, {
      headers: { Origin: origin },
      data: { version: post.version },
    });
    expect(withdrawn.status()).toBe(200);
    post = postSchema.parse((await withdrawn.json()).post);
    expect((await guest.get(image("public", 960))).status()).toBe(404);
    expect((await guest.head(image("public", 480))).status()).toBe(404);
  } finally {
    const removed = await request.delete(`/api/posts/${post.id}`, {
      headers: { Origin: origin },
      data: { version: post.version },
    });
    expect(removed.ok()).toBe(true);
    await guest.dispose();
  }
});
