import { z } from "zod";
import {
  articleTypeListSchema,
  articleTypeIdSchema,
} from "../../src/modules/article-types/contracts";
import { canonicalArticleType } from "../../src/modules/article-types/server";
import { D1PostRepository } from "../../src/server/content/repository";
import { PostService } from "../../src/server/content/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAPI } from "../../src/server/api";
import {
  defaultSettings,
  postSchema,
  patchSettingsSchema,
  settingsSchema,
} from "../../src/shared/contracts";
import { createToken } from "../../src/server/tokens";
import { fixtureEnv } from "./support";
let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => {
  env.DB.close();
  vi.restoreAllMocks();
});
const testPayloadSchema = z.looseObject({
  post: postSchema.optional(),
  settings: settingsSchema.optional(),
  types: articleTypeListSchema.optional(),
  selectedId: articleTypeIdSchema.optional(),
});
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  owner = true,
  origin = "https://site.test",
) {
  const response = await handleAPI({
    request: new Request(`https://site.test/api/${path}`, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(owner ? { "oai-authenticated-user-id": "test-owner" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: { env },
  });
  return {
    status: response.status,
    json: async () => testPayloadSchema.parse(await response.json()),
  };
}
async function types() {
  return (await (await call("article-types")).json()).types!;
}
describe("文章类型：真实 SQLite、鉴权与旧数据", () => {
  it("历史别名达到上限后更名422，失败不写入或损坏后续读取", async () => {
    const before = {
      ...defaultSettings,
      articleTypes: [
        {
          id: "ai",
          name: "AI",
          legacyNames: Array.from({ length: 100 }, (_, i) => `历史${i}`),
        },
      ],
    };
    await env.DB.prepare(
      "INSERT INTO settings (id,document_json,updated_at) VALUES (1,?,?)",
    )
      .bind(JSON.stringify(before), new Date().toISOString())
      .run();
    const response = await call("article-types", "POST", {
      action: "rename",
      id: "ai",
      name: "超限更名",
    });
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("历史名称已达上限");
    expect(await types()).toEqual(before.articleTypes);
  });

  it("更名记录历史名称供旧文章匹配，不能被其它类型抢占且删除仍保护旧文", async () => {
    await call("posts", "POST", {
      title: "旧文",
      category: "AI",
      tags: ["旧标签"],
    });
    const renamed = await (
      await call("article-types", "POST", {
        action: "rename",
        id: "ai",
        name: "人工智能",
      })
    ).json();
    expect(renamed.types!.find((t) => t.id === "ai")).toMatchObject({
      legacyNames: ["AI"],
    });
    expect(
      (await call("article-types", "POST", { action: "create", name: "ai" }))
        .status,
    ).toBe(409);
    expect(
      (
        await call("article-types", "POST", {
          action: "rename",
          id: "reflection",
          name: "AI",
        })
      ).status,
    ).toBe(409);
    const removed = await call("article-types", "POST", {
      action: "delete",
      id: "ai",
    });
    expect(removed.status).toBe(409);
    expect(JSON.stringify(await removed.json())).toContain(
      "仍有文章使用此类型",
    );
  });

  it("文章校验后类型被删除，新建/改类型的真实SQL写入失败且不留假revision", async () => {
    const service = new PostService(new D1PostRepository(env.DB));
    const old = await service.create({ title: "已有文章", blocks: [] });
    const ready = await canonicalArticleType(env, {
      title: "竞争新建",
      blocks: [],
      categoryId: "ai",
    });
    const patch = await canonicalArticleType(
      env,
      { version: 1, categoryId: "ai" },
      old,
    );
    expect(
      (await call("article-types", "POST", { action: "delete", id: "ai" }))
        .status,
    ).toBe(200);
    await expect(service.create(ready)).rejects.toThrow();
    await expect(service.update(old.id, patch)).rejects.toThrow();
    expect((await service.repository.get(old.id))?.draft.version).toBe(1);
    expect(await service.repository.revisions(old.id)).toHaveLength(1);
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM posts",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it.each(["draft-id", "published-id", "legacy", "trash"])(
    "被文章引用的类型禁止删除：%s",
    async (kind) => {
      const created = await (
        await call("posts", "POST", {
          title: "保护分类",
          ...(kind === "legacy" ? { category: "AI" } : { categoryId: "ai" }),
        })
      ).json();
      if (kind === "published-id") {
        await call(`posts/${created.post!.id}/publish`, "POST", {
          version: 1,
          visibility: "public",
        });
        await call(`posts/${created.post!.id}`, "PATCH", {
          version: 2,
          categoryId: null,
        });
      }
      if (kind === "trash")
        await call(`posts/${created.post!.id}`, "DELETE", { version: 1 });
      const removed = await call("article-types", "POST", {
        action: "delete",
        id: "ai",
      });
      expect(removed.status).toBe(409);
      expect(JSON.stringify(await removed.json())).toContain(
        "仍有文章使用此类型",
      );
      expect((await types()).some((t: { id: string }) => t.id === "ai")).toBe(
        true,
      );
    },
  );

  it("写文章Token不能维护类型目录", async () => {
    const token = await createToken(env, {
      name: "测试",
      scopes: ["posts:write"],
      expiresInDays: 1,
    });
    const response = await handleAPI({
      request: new Request("https://site.test/api/article-types", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "create", name: "不应创建" }),
      }),
      locals: { env },
    });
    expect(response.status).toBe(403);
    expect(await types()).toHaveLength(2);
  });
  it("持续CAS冲突有限退出，不把未写成功当成功", async () => {
    await call("settings", "PATCH", { siteTitle: "原值" });
    const original = env.DB.prepare.bind(env.DB);
    let attempts = 0;
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      const statement = original(sql);
      if (sql.startsWith("UPDATE settings SET document_json=?"))
        statement.run = async () => {
          attempts++;
          return { success: true, meta: { changes: 0 } };
        };
      return statement;
    });
    const response = await call("article-types", "POST", {
      action: "create",
      name: "竞争",
    });
    expect(response.status).toBe(409);
    expect(attempts).toBe(4);
    expect(await types()).toHaveLength(2);
  });
  it("名称NFC归一化防重，删除所有项后空列表不重新补预设", async () => {
    expect(
      (
        await call("article-types", "POST", {
          action: "create",
          name: "e\u0301",
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("article-types", "POST", { action: "create", name: "é" }))
        .status,
    ).toBe(409);
    for (const item of await types())
      await call("article-types", "POST", { action: "delete", id: item.id });
    expect(await types()).toEqual([]);
    expect(
      (await (await call("settings")).json()).settings!.articleTypes,
    ).toEqual([]);
  });

  it("旧客户端只改分类文字时解除旧ID，未改分类的patch保持ID", async () => {
    const made = await (
      await call("posts", "POST", { title: "旧客户端编辑", categoryId: "ai" })
    ).json();
    const unchanged = await (
      await call(`posts/${made.post!.id}`, "PATCH", {
        version: 1,
        title: "只改标题",
      })
    ).json();
    expect(unchanged.post!.categoryId).toBe("ai");
    const changed = await (
      await call(`posts/${made.post!.id}`, "PATCH", {
        version: 2,
        category: "手写旧类型",
      })
    ).json();
    expect(changed.post!).toMatchObject({
      categoryId: null,
      category: "手写旧类型",
    });
  });

  it("旧设置默认AI/感悟，普通设置patch不能绕过专用写入口", async () => {
    const { articleTypes: ignored, ...old } =
      defaultSettings as typeof defaultSettings & { articleTypes?: unknown };
    expect(settingsSchema.parse(old)).toHaveProperty("articleTypes", [
      { id: "ai", name: "AI" },
      { id: "reflection", name: "感悟" },
    ]);
    expect(patchSettingsSchema.safeParse({ articleTypes: [] }).success).toBe(
      false,
    );
    const response = await call("article-types", "GET", undefined, false);
    expect(response.status).toBe(200);
    expect((await response.json()).types!).toHaveLength(2);
  });
  it("新增/重命名/删除保持稳定ID，不允许重复名称，保留其它设置", async () => {
    await call("settings", "PATCH", { siteTitle: "保留站名" });
    const added = await call("article-types", "POST", {
      action: "create",
      name: "  技术  ",
    });
    expect(added.status).toBe(200);
    const data = await added.json();
    expect(data.types!.at(-1)).toEqual({ id: data.selectedId, name: "技术" });
    expect(
      (await call("article-types", "POST", { action: "create", name: "ai" }))
        .status,
    ).toBe(409);
    const renamed = await (
      await call("article-types", "POST", {
        action: "rename",
        id: data.selectedId,
        name: "开发",
      })
    ).json();
    expect(renamed.types!.at(-1)).toEqual({
      id: data.selectedId,
      name: "开发",
      legacyNames: ["技术"],
    });
    expect((await (await call("settings")).json()).settings!.siteTitle).toBe(
      "保留站名",
    );
    await call("article-types", "POST", {
      action: "delete",
      id: data.selectedId,
    });
    expect(await types()).toHaveLength(2);
  });
  it("无作者身份及跨站写入失败，未知字段/空名称失败且无数据变化", async () => {
    expect(
      (
        await call(
          "article-types",
          "POST",
          { action: "create", name: "坏" },
          false,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "article-types",
          "POST",
          { action: "create", name: "坏" },
          true,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("article-types", "POST", { action: "create", name: " " }))
        .status,
    ).toBe(422);
    expect(
      (
        await call("article-types", "POST", {
          action: "create",
          name: "坏",
          id: "forged",
        })
      ).status,
    ).toBe(422);
    expect(await types()).toHaveLength(2);
  });
  it("并发新增两种类型和其它配置不丢数据；同名竞争只保存一个", async () => {
    const results = await Promise.all([
      call("article-types", "POST", { action: "create", name: "甲" }),
      call("article-types", "POST", { action: "create", name: "乙" }),
      call("settings", "PATCH", { tagline: "并发副标题" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await types()).map((t: { name: string }) => t.name)).toEqual([
      "AI",
      "感悟",
      "甲",
      "乙",
    ]);
    expect((await (await call("settings")).json()).settings!.tagline).toBe(
      "并发副标题",
    );
    const duplicates = await Promise.all([
      call("article-types", "POST", { action: "create", name: "重复" }),
      call("article-types", "POST", { action: "create", name: "重复" }),
    ]);
    expect(duplicates.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("有效ID使用设置名称；未知ID拒绝；删除类型不破坏旧文章及标签", async () => {
    const made = await call("posts", "POST", {
      title: "类型文章",
      categoryId: "ai",
      category: "伪造名称",
      tags: ["独立标签"],
    });
    expect(made.status).toBe(201);
    const post = (await made.json()).post!;
    expect(post.category).toBe("AI");
    expect(post.categoryId).toBe("ai");
    expect(
      (await call("posts", "POST", { title: "非法", categoryId: "missing" }))
        .status,
    ).toBe(422);
    await call("settings", "PATCH", { siteTitle: "旧数据" });
    // 模拟上线前已有的缺失类型记录；真实删除入口不得制造这种状态。
    await env.DB.prepare(
      "UPDATE settings SET document_json=json_set(document_json,'$.articleTypes',json('[]')) WHERE id=1",
    ).run();
    const edited = await call(`posts/${post.id}`, "PATCH", {
      version: post.version,
      title: "保留旧分类",
      categoryId: "ai",
      category: "被改坏",
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).post!).toMatchObject({
      category: "AI",
      categoryId: "ai",
      tags: ["独立标签"],
    });
    const legacy = await call("posts", "POST", {
      title: "旧客户端",
      category: "旧自由分类",
    });
    expect((await legacy.json()).post!.category).toBe("旧自由分类");
  });
});
