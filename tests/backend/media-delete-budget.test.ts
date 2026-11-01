import { it, expect } from "vitest";
import { fixtureEnv } from "./support";
import { D1PostRepository } from "../../src/server/content/repository";
import { handleAPI } from "../../src/server/api";
import type { D1Database, D1Statement } from "../../src/server/runtime";
import { defaultPost } from "../fixtures/editor-post";
import { captureLogs } from "./log-capture";
import { vi } from "vitest";
/** 注入每调用50次的D1预算；batch整次只计1次。不是本地workerd的真实免费套餐配额。 */
class BudgetD1 implements D1Database {
  used = 0;
  inBatch = false;
  constructor(
    readonly inner: D1Database,
    readonly limit: number,
  ) {}
  consume() {
    if (!this.inBatch && ++this.used > this.limit)
      throw new Error("Too many API requests by single Worker invocation");
  }
  prepare(sql: string): D1Statement {
    const statement = this.inner.prepare(sql),
      owner = this;
    const wrapper: D1Statement = {
      bind(...v) {
        statement.bind(...v);
        return wrapper;
      },
      async first<T>(column?: string) {
        owner.consume();
        return statement.first<T>(column);
      },
      async all<T>() {
        owner.consume();
        return statement.all<T>();
      },
      async run() {
        owner.consume();
        return statement.run();
      },
    };
    return wrapper;
  }
  async batch(statements: D1Statement[]) {
    this.consume();
    this.inBatch = true;
    try {
      return await this.inner.batch(statements);
    } finally {
      this.inBatch = false;
    }
  }
}
it("30篇引用触发注入预算：失败保留媒体与正文，允许重试收敛，但部分封面已清理", async () => {
  const original = fixtureEnv(),
    repo = new D1PostRepository(original.DB),
    id = "budget-cover",
    url = `/api/files/${id}`,
    key = `media/${id}`;
  try {
    await original.BUCKET.put(key, new Uint8Array([1]));
    await original.DB.prepare(
      "INSERT INTO media (id,object_key,name,mime,size,post_id,source,prompt,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        key,
        "isolated.png",
        "image/png",
        1,
        null,
        "upload",
        null,
        new Date().toISOString(),
      )
      .run();
    const posts = Array.from({ length: 30 }, (_, i) => ({
      ...defaultPost(),
      id: `budget-${String(i).padStart(2, "0")}`,
      slug: `budget-${i}`,
      coverImage: url,
    }));
    for (const draft of posts)
      await repo.create({
        draft,
        published: null,
        passwordHash: null,
        publishedPasswordHash: null,
      });
    const db = new BudgetD1(original.DB, 50),
      env = { ...original, DB: db };
    const logs = captureLogs();
    const remove = () =>
      handleAPI({
        request: new Request(`https://site.test/api/media/${id}?force=1`, {
          method: "DELETE",
          headers: {
            Origin: "https://site.test",
            "oai-authenticated-user-id": "test-owner",
          },
        }),
        locals: { env },
      });
    const first = await remove();
    expect(first.status).toBe(500);
    const firstResponse = await first.json();
    const after = await Promise.all(posts.map((p) => repo.get(p.id))),
      cleared = after.filter((p) => p!.draft.coverImage === "").length;
    expect(cleared).toBeGreaterThan(0);
    expect(cleared).toBeLessThan(posts.length);
    expect(
      await original.DB.prepare("SELECT id FROM media WHERE id=?")
        .bind(id)
        .first(),
    ).not.toBeNull();
    expect(original.BUCKET.objects.has(key)).toBe(true);
    for (const row of after) {
      expect(row!.draft.title).toBe("原始标题");
      expect(row!.draft.blocks).toEqual(defaultPost().blocks);
    }
    expect(logs.records().some((r) => r.level === "error")).toBe(true);
    db.used = 0;
    const retry = await remove();
    expect(retry.status).toBe(200);
    expect(original.BUCKET.objects.has(key)).toBe(false);
    const final = await Promise.all(posts.map((p) => repo.get(p.id)));
    expect(final.every((p) => p!.draft.coverImage === "")).toBe(true);
    expect(
      final.every(
        (p) =>
          JSON.stringify(p!.draft.blocks) ===
          JSON.stringify(defaultPost().blocks),
      ),
    ).toBe(true);
    vi.restoreAllMocks();
    console.log("INJECTED_D1_BUDGET", {
      limit: 50,
      firstStatus: first.status,
      firstResponse,
      clearedBeforeFailure: cleared,
      total: posts.length,
      retryStatus: retry.status,
      bodyPreserved: true,
      realPlatformQuota: false,
    });
  } finally {
    vi.restoreAllMocks();
    original.DB.close();
  }
});
