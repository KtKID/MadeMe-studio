import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAPI } from "../../src/server/api";
import { createToken } from "../../src/server/tokens";
import { PostService } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
import { readSettings, writeSettings } from "../../src/server/settings";
import {
  patchSettingsSchema,
  type BootstrapResponse,
} from "../../src/shared/contracts";
import * as pageData from "../../src/server/page-data";
import { fixtureEnv, blocks } from "./support";
let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => env.DB.close());
async function request(path: string, body: unknown, token?: string) {
  return handleAPI({
    request: new Request(`https://site.test/api/${path}`, {
      method: path.includes("/publish")
        ? "POST"
        : path.startsWith("posts/")
          ? "PATCH"
          : "POST",
      headers: {
        Origin: "https://site.test",
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : { "oai-authenticated-user-id": "test-owner" }),
      },
      body: JSON.stringify(body),
    }),
    locals: { env },
  });
}
describe("审查回归：先复现再修复", () => {
  it("write-only token 的空 PATCH 不返回已有私密草稿", async () => {
    const service = new PostService(new D1PostRepository(env.DB));
    const post = await service.create({
      title: "Private title",
      blocks: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "PRIVATE_EXISTING_CONTENT", styles: {} },
          ],
        },
      ],
    });
    const token = await createToken(env, {
      name: "write only",
      scopes: ["posts:write"],
      expiresInDays: 1,
    });
    const response = await request(
      `posts/${post.id}`,
      { version: 1 },
      token.token,
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({ post: { id: post.id, version: 2 } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_EXISTING_CONTENT");
  });
  it("write-only create 和 publish-only 发布均仅返回 id/version 回执", async () => {
    const token = await createToken(env, {
      name: "publisher",
      scopes: ["posts:write", "posts:publish"],
      expiresInDays: 1,
    });
    const created = await request(
      "posts",
      { title: "Input title", blocks },
      token.token,
    );
    const result = (await created.json()) as {
      post: { id: string; version: number };
    };
    expect(Object.keys(result.post).sort()).toEqual(["id", "version"]);
    const published = await request(
      `posts/${result.post.id}/publish`,
      { version: result.post.version },
      token.token,
    );
    expect(
      Object.keys(((await published.json()) as { post: object }).post).sort(),
    ).toEqual(["id", "version"]);
  });
  it.each([
    { type: "table", content: { rows: [{}] } },
    {
      type: "table",
      content: { type: "tableContent", rows: [{ cells: "not-an-array" }] },
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: { malformed: true }, styles: {} }],
    },
  ])("畸形块在写入前返回422而不是让SSR崩溃：%j", async (block) => {
    const response = await request("posts", {
      title: "Bad block",
      blocks: [block],
    });
    expect(response.status).toBe(422);
    expect(await new D1PostRepository(env.DB).list()).toEqual([]);
  });
  it("接受BlockNote完整tableCell和简写单元格数组结构", async () => {
    const text = { type: "text", text: "Cell", styles: { bold: true } };
    const response = await request("posts", {
      title: "Valid table",
      blocks: [
        {
          type: "table",
          content: {
            type: "tableContent",
            columnWidths: [null, 160],
            headerRows: 1,
            rows: [
              {
                cells: [
                  {
                    type: "tableCell",
                    props: {
                      backgroundColor: "default",
                      textColor: "default",
                      textAlignment: "left",
                    },
                    content: [text],
                  },
                  [text],
                ],
              },
            ],
          },
        },
      ],
    });
    expect(response.status).toBe(201);
  });
  it("并发保存不同设置字段不得丢失其他写入", async () => {
    await Promise.all([
      writeSettings(env, { mode: "dark" }),
      writeSettings(env, { font: "serif" }),
      writeSettings(env, { skin: "sage" }),
    ]);
    expect(await readSettings(env)).toMatchObject({
      mode: "dark",
      font: "serif",
      skin: "sage",
    });
  });
  it("accent:null清除自定义色后仍保持其他设置与完整协议", async () => {
    await writeSettings(env, { accent: "#112233", mode: "dark" });
    await writeSettings(env, patchSettingsSchema.parse({ accent: null }));
    expect(await readSettings(env)).toMatchObject({
      accent: null,
      mode: "dark",
    });
  });
  it("作者首页也只能读取公开已发布快照而不是工作草稿", async () => {
    const service = new PostService(new D1PostRepository(env.DB));
    const post = await service.create({ title: "Published", blocks });
    await service.publish(post.id, { version: 1 });
    await service.update(post.id, {
      version: 2,
      title: "Private draft changes",
    });
    expect(pageData).toHaveProperty("loadPublicPageData");
    const loader = (
      pageData as unknown as {
        loadPublicPageData: typeof pageData.loadPageData;
      }
    ).loadPublicPageData;
    const data: BootstrapResponse = await loader({
      request: new Request("https://site.test", {
        headers: { "oai-authenticated-user-id": "test-owner" },
      }),
      locals: { env },
    });
    expect(data.posts.map((p) => p.title)).toEqual(["Published"]);
    expect(data.settings.customCode).toBe("");
  });
});
