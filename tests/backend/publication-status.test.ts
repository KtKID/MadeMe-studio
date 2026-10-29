import { publicationStatus } from "../../src/modules/publication-status/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { handleAPI } from "../../src/server/api";
import {
  postResponseSchema,
  postsResponseSchema,
} from "../../src/shared/contracts";
import { D1PostRepository } from "../../src/server/content/repository";
import { fixtureEnv, blocks } from "./support";
let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => env.DB.close());
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  owner = true,
) {
  return handleAPI({
    request: new Request(`https://site.test/api/${path}`, {
      method,
      headers: {
        Origin: "https://site.test",
        "Content-Type": "application/json",
        ...(owner ? { "oai-authenticated-user-id": "test-owner" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: { env },
  });
}
async function write(path: string, method: string, body: unknown) {
  const response = await request(path, method, body);
  expect(response.status).toBeLessThan(300);
  return postResponseSchema.parse(await response.json()).post;
}
async function published(visibility: "public" | "unlisted" = "unlisted") {
  const p = await write("posts", "POST", {
    title: "线上原文",
    blocks,
    categoryId: "ai",
    category: "AI",
  });
  return write(`posts/${p.id}/publish`, "POST", {
    version: p.version,
    visibility,
  });
}
it("真实接口发布→持久化草稿有改动→还原→重新发布；不影响仅链接访问的线上快照", async () => {
  let p = await published();
  expect(p.hasUnpublishedChanges).toBe(false);
  expect(p.publishedVisibility).toBe("unlisted");
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    title: "只在草稿的新标题",
  });
  expect(p.hasUnpublishedChanges).toBe(true);
  const owner = postsResponseSchema.parse(
    await (await request("posts")).json(),
  );
  expect(owner.posts[0].hasUnpublishedChanges).toBe(true);
  const anonymous = postResponseSchema.parse(
    await (await request(`posts/${p.id}`, "GET", undefined, false)).json(),
  );
  expect(anonymous.post.title).toBe("线上原文");
  expect(anonymous.post).not.toHaveProperty("hasUnpublishedChanges");
  expect(
    postsResponseSchema.parse(
      await (await request("posts", "GET", undefined, false)).json(),
    ).posts,
  ).toEqual([]);
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    title: "线上原文",
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    excerpt: "新摘要",
  });
  expect(p.hasUnpublishedChanges).toBe(true);
  p = await write(`posts/${p.id}/publish`, "POST", {
    version: p.version,
    visibility: "unlisted",
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  const summaries = await new D1PostRepository(env.DB).listSummaries();
  expect(summaries[0].hasUnpublishedChanges).toBe(false);
  expect(summaries[0]).not.toHaveProperty("blocks");
});
it("无变化保存、块ID/对象键顺序/默认展示属性变化不误报；无快照草稿不误报", async () => {
  let p = await write("posts", "POST", { title: "未发布", blocks });
  expect(p.hasUnpublishedChanges).toBe(false);
  expect(p.publishedVisibility).toBeNull();
  p = await published("public");
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    title: p.title,
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  const normalized = structuredClone(p.blocks).map((b) => ({
    ...b,
    id: crypto.randomUUID(),
    props: {
      textAlignment: "left",
      textColor: "default",
      backgroundColor: "default",
      ...(b.props && typeof b.props === "object" ? b.props : {}),
    },
    children: b.children ?? [],
  }));
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    blocks: normalized,
  });
  expect(p.hasUnpublishedChanges).toBe(false);
});
it.each([
  { title: "新标题" },
  { excerpt: "新摘要" },
  { coverImage: "https://example.com/new.png" },
  { tags: ["新标签"] },
  { slug: "new-slug" },
  { categoryId: "reflection", category: "感悟" },
  { pinned: true },
  {
    blocks: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "新正文", styles: { bold: true } }],
      },
    ],
  },
])("各公开内容字段实际变化均标记：%j", async (patch) => {
  let p = await published();
  p = await write(`posts/${p.id}`, "PATCH", { version: p.version, ...patch });
  expect(p.hasUnpublishedChanges).toBe(true);
});
it("稳定类型更名及旧分类历史别名不制造草稿差异", async () => {
  let p = await published();
  await request("article-types", "POST", {
    action: "rename",
    id: "ai",
    name: "人工智能",
  });
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    categoryId: "ai",
    category: "人工智能",
  });
  expect(p.hasUnpublishedChanges).toBe(false);
  const repo = new D1PostRepository(env.DB);
  const row = (await repo.get(p.id))!;
  delete row.published!.categoryId;
  row.published!.category = "AI";
  env.DB.sqlite
    .prepare("UPDATE posts SET published_json=? WHERE id=?")
    .run(JSON.stringify(row.published), p.id);
  const result = postResponseSchema.parse(
    await (await request(`posts/${p.id}`)).json(),
  ).post;
  expect(result.hasUnpublishedChanges).toBe(false);
});
it("只读状态字段不能通过编辑协议注入，也不存入文章JSON", async () => {
  const p = await published();
  expect(
    (
      await request(`posts/${p.id}`, "PATCH", {
        version: p.version,
        hasUnpublishedChanges: false,
      })
    ).status,
  ).toBe(422);
  const row = await new D1PostRepository(env.DB).get(p.id);
  expect(row?.draft).not.toHaveProperty("hasUnpublishedChanges");
  expect(row?.published).not.toHaveProperty("publishedVisibility");
});

it("渲染器忽略的 false 布尔文字样式不算未发布变化", async () => {
  let p = await published();
  p = await write(`posts/${p.id}`, "PATCH", {
    version: p.version,
    blocks: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Original text",
            styles: {
              bold: false,
              italic: false,
              underline: false,
              strike: false,
              code: false,
            },
          },
        ],
      },
    ],
  });
  expect(p.hasUnpublishedChanges).toBe(false);
});

it("兼容旧JSON时只忽略结构块ID，不忽略媒体属性内部ID", async () => {
  const p = await published();
  const row = (await new D1PostRepository(env.DB).get(p.id))!;
  row.draft.blocks = [
    {
      type: "paragraph",
      props: { media: { type: "image", id: "media-b", content: "说明" } },
    },
  ];
  row.published!.blocks = [
    {
      type: "paragraph",
      props: { media: { type: "image", id: "media-a", content: "说明" } },
    },
  ];
  expect(publicationStatus(row).hasUnpublishedChanges).toBe(true);
});

it("旧缺失类型ID的显示名称改变仍算内容变化", async () => {
  const p = await published();
  const row = (await new D1PostRepository(env.DB).get(p.id))!;
  row.draft.categoryId = "missing-type";
  row.published!.categoryId = "missing-type";
  row.published!.category = "原显示分类";
  row.draft.category = "新显示分类";
  expect(publicationStatus(row).hasUnpublishedChanges).toBe(true);
  row.draft.category = "原显示分类";
  expect(publicationStatus(row).hasUnpublishedChanges).toBe(false);
});
