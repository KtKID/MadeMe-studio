import { describe, it, expect } from "vitest";
import {
  recordPageView,
  recordPageViewSafely,
  readPostViewCount,
  listTopPaths,
  visitSummary,
  listVisitors,
  buildPageViewEvent,
  type PageViewEvent,
} from "../../src/server/page-views";
import { handleAPI } from "../../src/server/api";
import type { RuntimeEnv } from "../../src/server/runtime";
import { PostService } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
import { fixtureEnv, blocks } from "./support";

const visitorEvent: PageViewEvent = {
  ts: 1793568000123,
  path: "/p/hello",
  ip: "203.0.113.7",
  country: "CN",
  ua: "Mozilla/5.0 (Macintosh) Test/1.0",
  referer: "https://example.com/link",
  durationMs: 42,
  status: 200,
};

describe("访问记录", () => {
  it("记录事件完整保存全部字段（明文 IP 与毫秒时间戳）", async () => {
    const env = fixtureEnv();
    try {
      await recordPageView(env, visitorEvent);
      const row = env.DB.sqlite
        .prepare("SELECT * FROM page_view_events")
        .get() as Record<string, unknown>;
      expect(row).toMatchObject({
        ts: 1793568000123,
        path: "/p/hello",
        ip: "203.0.113.7",
        country: "CN",
        ua: visitorEvent.ua,
        referer: visitorEvent.referer,
        duration_ms: 42,
        status: 200,
      });
    } finally {
      env.DB.close();
    }
  });

  it("无数据库绑定时记录不抛错", async () => {
    await expect(recordPageView({}, visitorEvent)).resolves.toBeUndefined();
  });

  it("数据库写入失败时安全记录只写日志不抛错", async () => {
    const env = {
      DB: {
        prepare() {
          throw new Error("d1 unavailable");
        },
        batch: async () => [],
      },
    } as unknown as RuntimeEnv;
    await expect(
      recordPageViewSafely(env, visitorEvent),
    ).resolves.toBeUndefined();
  });

  it("从请求与响应构造事件：头部与 cf 元数据映射", () => {
    const request = new Request("https://site.test/p/hello", {
      headers: {
        "cf-connecting-ip": "198.51.100.9",
        "user-agent": "Mozilla/5.0 Test/2.0",
        referer: "https://news.example/",
      },
    });
    (request as unknown as { cf?: { country?: string } }).cf = {
      country: "JP",
    };
    const built = buildPageViewEvent(
      request,
      new Response("ok"),
      Date.now() - 15,
      "/p/hello",
    );
    expect(built.ip).toBe("198.51.100.9");
    expect(built.country).toBe("JP");
    expect(built.ua).toBe("Mozilla/5.0 Test/2.0");
    expect(built.referer).toBe("https://news.example/");
    expect(built.status).toBe(200);
    expect(built.path).toBe("/p/hello");
    expect(built.durationMs).toBeGreaterThanOrEqual(0);
    expect(Math.abs(built.ts - Date.now())).toBeLessThan(5000);
  });

  it("无 cf 元数据与空头部时字段为 null", () => {
    const built = buildPageViewEvent(
      new Request("https://site.test/p/hello"),
      new Response(null, { status: 304 }),
      Date.now(),
      "/p/hello",
    );
    expect(built.ip).toBeNull();
    expect(built.country).toBeNull();
    expect(built.ua).toBeNull();
    expect(built.referer).toBeNull();
    expect(built.status).toBe(304);
  });

  it("阅读数只计访客 200，爬虫与非 200 不计入", async () => {
    const env = fixtureEnv();
    try {
      await recordPageView(env, visitorEvent);
      await recordPageView(env, {
        ...visitorEvent,
        ua: "Mozilla/5.0 (compatible; Googlebot/2.1)",
      });
      await recordPageView(env, { ...visitorEvent, status: 304 });
      await recordPageView(env, { ...visitorEvent, referer: null });
      expect(await readPostViewCount(env, "/p/hello")).toBe(2);
    } finally {
      env.DB.close();
    }
  });

  it("不同文章路径计数隔离，未知路径为 0", async () => {
    const env = fixtureEnv();
    try {
      await recordPageView(env, visitorEvent);
      await recordPageView(env, { ...visitorEvent, path: "/p/other" });
      expect(await readPostViewCount(env, "/p/hello")).toBe(1);
      expect(await readPostViewCount(env, "/p/other")).toBe(1);
      expect(await readPostViewCount(env, "/p/missing")).toBe(0);
    } finally {
      env.DB.close();
    }
  });

  it("无数据库绑定时阅读数为 null", async () => {
    expect(await readPostViewCount({}, "/p/hello")).toBeNull();
  });

  it("阅读数查询失败（如迁移未应用）返回 null 而非抛错", async () => {
    const env = {
      DB: {
        prepare() {
          throw new Error("no such table: page_view_events");
        },
        batch: async () => [],
      },
    } as unknown as RuntimeEnv;
    expect(await readPostViewCount(env, "/p/hello")).toBeNull();
  });

  it("热门文章按窗口过滤并降序排名", async () => {
    const env = fixtureEnv();
    try {
      const now = Date.now();
      const before = now - 10 * 60 * 1000;
      await recordPageView(env, { ...visitorEvent, ts: now, path: "/p/a" });
      await recordPageView(env, { ...visitorEvent, ts: now, path: "/p/a" });
      await recordPageView(env, {
        ...visitorEvent,
        ts: now,
        path: "/p/a",
        ua: "bingbot",
      });
      await recordPageView(env, { ...visitorEvent, ts: before, path: "/p/b" });
      await recordPageView(env, { ...visitorEvent, ts: before, path: "/p/b" });
      expect(
        await listTopPaths(env, { sinceMs: now - 60_000, limit: 10 }),
      ).toEqual([{ path: "/p/a", views: 2 }]);
      expect(
        await listTopPaths(env, { sinceMs: now - 60 * 60 * 1000, limit: 10 }),
      ).toEqual([
        { path: "/p/a", views: 2 },
        { path: "/p/b", views: 2 },
      ]);
      expect(await listTopPaths(env, { sinceMs: 0, limit: 1 })).toEqual([
        { path: "/p/a", views: 2 },
      ]);
    } finally {
      env.DB.close();
    }
  });
});

describe("访问记录冒烟", () => {
  it("真实 SQLite 上记录→阅读数→热门排名完整链路", async () => {
    const env = fixtureEnv();
    try {
      const service = new PostService(new D1PostRepository(env.DB));
      const post = await service.create({ title: "Hello", blocks });
      await service.publish(post.id, { version: 1 });
      const path = `/p/${post.slug}`;
      await recordPageView(env, {
        ts: Date.now(),
        path,
        ip: "192.0.2.10",
        country: null,
        ua: "Mozilla/5.0",
        referer: null,
        durationMs: 5,
        status: 200,
      });
      expect(await readPostViewCount(env, path)).toBe(1);
      expect(
        await listTopPaths(env, { sinceMs: Date.now() - 60_000, limit: 5 }),
      ).toEqual([{ path, views: 1 }]);
    } finally {
      env.DB.close();
    }
  });
});

describe("访问汇总与访客列表", () => {
  const ok = {
    country: "CN",
    referer: null,
    ua: "Mozilla/5.0",
    durationMs: 3,
    status: 200,
  };
  async function seed(env: ReturnType<typeof fixtureEnv>) {
    const now = Date.now();
    // 1.1.1.1 先从 US 访问、后从 CN 访问：列表应显示最近一次的 CN（字典序最大的是 US，用以区分口径）。
    await recordPageView(env, {
      ts: now,
      path: "/p/a",
      ip: "1.1.1.1",
      ...ok,
      country: "US",
    });
    await recordPageView(env, {
      ts: now + 1,
      path: "/p/b",
      ip: "1.1.1.1",
      ...ok,
    });
    await recordPageView(env, {
      ts: now + 2,
      path: "/p/a",
      ip: "2.2.2.2",
      ...ok,
      country: "JP",
    });
    await recordPageView(env, {
      ts: now + 3,
      path: "/p/a",
      ip: null,
      ...ok,
      country: null,
    });
    await recordPageView(env, {
      ts: now + 4,
      path: "/p/a",
      ip: "3.3.3.3",
      ...ok,
      ua: "Googlebot",
    });
    await recordPageView(env, {
      ts: now + 5,
      path: "/p/a",
      ip: "4.4.4.4",
      ...ok,
      status: 304,
    });
    return now;
  }
  it("汇总：只计访客 200，访客按 IP 去重（无 IP 归一组），支持时间窗口", async () => {
    const env = fixtureEnv();
    try {
      const now = await seed(env);
      expect(await visitSummary(env)).toEqual({ visits: 4, visitors: 3 });
      expect(await visitSummary(env, { sinceMs: now + 2 })).toEqual({
        visits: 2,
        visitors: 2,
      });
    } finally {
      env.DB.close();
    }
  });
  it("访客列表：按最近访问倒序，国家取该 IP 最近一次访问的值", async () => {
    const env = fixtureEnv();
    try {
      const now = await seed(env);
      const result = await listVisitors(env);
      expect(result.total).toBe(3);
      expect(result.totalPages).toBe(1);
      expect(result.items).toEqual([
        { ip: null, views: 1, lastTs: now + 3, country: null },
        { ip: "2.2.2.2", views: 1, lastTs: now + 2, country: "JP" },
        { ip: "1.1.1.1", views: 2, lastTs: now + 1, country: "CN" },
      ]);
    } finally {
      env.DB.close();
    }
  });
  it("访客列表：分页边界（越界夹紧到最后一页）与无数据库绑定", async () => {
    const env = fixtureEnv();
    try {
      await seed(env);
      const page2 = await listVisitors(env, { page: 2, pageSize: 2 });
      expect(page2.items.map((row) => row.ip)).toEqual(["1.1.1.1"]);
      expect(page2.totalPages).toBe(2);
      expect(page2.page).toBe(2);
      const beyond = await listVisitors(env, { page: 3, pageSize: 2 });
      expect(beyond.page).toBe(2);
      expect(beyond.items.map((row) => row.ip)).toEqual(["1.1.1.1"]);
      const far = await listVisitors(env, { page: 99 });
      expect(far.page).toBe(1);
      expect(far.items).toHaveLength(3);
      expect((await listVisitors(env, { page: 0 })).page).toBe(1);
      expect(await listVisitors({})).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });
    } finally {
      env.DB.close();
    }
  });
});

describe("访问统计 API", () => {
  function viewsGet(env: RuntimeEnv, path: string, owner = true) {
    return handleAPI({
      request: new Request(`https://site.test${path}`, {
        headers: owner ? { "oai-authenticated-user-id": "test-owner" } : {},
      }),
      locals: { env },
    });
  }
  type ViewsBody = {
    visits?: number;
    visitors?: number;
    total?: number;
    page?: number;
    pageSize?: number;
    items?: { ip: string; views: number }[];
  };
  async function json(response: Response): Promise<ViewsBody> {
    return (await response.json()) as ViewsBody;
  }
  it("作者可读汇总与访客分页，响应符合共享协议", async () => {
    const env = fixtureEnv();
    try {
      await recordPageView(env, {
        ts: Date.now(),
        path: "/p/hello",
        ip: "8.8.8.8",
        country: "CN",
        ua: "Mozilla/5.0",
        referer: null,
        durationMs: 1,
        status: 200,
      });
      const summary = await viewsGet(env, "/api/views/summary");
      expect(summary.status).toBe(200);
      expect(await json(summary)).toEqual({ visits: 1, visitors: 1 });
      const visitors = await viewsGet(env, "/api/views/visitors?page=1");
      const body = await json(visitors);
      expect(body.total).toBe(1);
      expect(body.pageSize).toBe(10);
      expect(body.items?.[0]).toMatchObject({ ip: "8.8.8.8", views: 1 });
    } finally {
      env.DB.close();
    }
  });
  it("访客请求被 401 拒绝，非法页码归一为 1", async () => {
    const env = fixtureEnv();
    try {
      expect((await viewsGet(env, "/api/views/summary", false)).status).toBe(
        401,
      );
      expect((await viewsGet(env, "/api/views/visitors", false)).status).toBe(
        401,
      );
      const bad = await viewsGet(env, "/api/views/visitors?page=abc");
      expect((await json(bad)).page).toBe(1);
    } finally {
      env.DB.close();
    }
  });
});
