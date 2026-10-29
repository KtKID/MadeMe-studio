import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureEnv, blocks } from "./support";
import { createToken } from "../../src/server/tokens";
import { PostService } from "../../src/server/content/service";
import { D1PostRepository } from "../../src/server/content/repository";
import {
  loadDashboardPageData,
  loadMediaPageData,
  loadIntegrationsPageData,
} from "../../src/server/page-data";
import { postSummarySchema } from "../../src/shared/contracts";
let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
  env.ENVIRONMENT = "development";
  env.ALLOW_LOCAL_DEV_IDENTITY = "true";
  env.DEV_OWNER_ID = "test-owner";
});
afterEach(() => {
  vi.restoreAllMocks();
  env.DB.close();
});
const context = () => ({
  request: new Request("http://localhost/studio"),
  locals: { env },
});
it("作者摘要在服务器比较快照，仅返回展示字段和只读状态，不传正文或密码", async () => {
  const repo = new D1PostRepository(env.DB);
  const post = await new PostService(repo).create({ title: "草稿", blocks });
  const spy = vi.spyOn(env.DB, "prepare");
  const result = await repo.listSummaries();
  expect(result).toEqual([postSummarySchema.parse(post)]);
  expect(Object.keys(result[0])).toHaveLength(14);
  expect(spy.mock.calls[0][0]).toContain("published_json");
  expect(spy.mock.calls[0][0]).not.toContain("password_hash");
  expect(JSON.stringify(result)).not.toContain("passwordHash");
  expect(JSON.stringify(result)).not.toContain('"blocks"');
});
it("作者工作台走摘要；访客只拿发布快照而非未发布改动", async () => {
  const service = new PostService(new D1PostRepository(env.DB));
  const draft = await service.create({ title: "已发布", blocks });
  await service.publish(draft.id, { version: 1, visibility: "public" });
  await service.update(draft.id, { version: 2, title: "私有改动" });
  const owner = await loadDashboardPageData(context());
  expect(owner.posts[0].title).toBe("私有改动");
  expect(owner.posts[0]).not.toHaveProperty("blocks");
  env.ALLOW_LOCAL_DEV_IDENTITY = "false";
  const visitor = await loadDashboardPageData(context());
  expect(visitor.posts[0].title).toBe("已发布");
});
it("未授权不查询媒体或令牌；SSR 查询失败有明确错误", async () => {
  env.ALLOW_LOCAL_DEV_IDENTITY = "false";
  const original = env.DB.prepare.bind(env.DB);
  const spy = vi.spyOn(env.DB, "prepare");
  expect((await loadMediaPageData(context())).initialMedia).toEqual([]);
  expect((await loadIntegrationsPageData(context())).initialTokens).toEqual([]);
  expect(
    spy.mock.calls.some(([sql]) => /FROM (media|api_tokens)/.test(sql)),
  ).toBe(false);
  env.ALLOW_LOCAL_DEV_IDENTITY = "true";
  spy.mockImplementation((sql) => {
    if (/FROM (media|api_tokens)/.test(sql))
      throw new Error("private database detail");
    return original(sql);
  });
  expect((await loadMediaPageData(context())).initialError).toBeTruthy();
  expect((await loadIntegrationsPageData(context())).initialError).toBeTruthy();
  expect(JSON.stringify(await loadMediaPageData(context()))).not.toContain(
    "private database detail",
  );
});

it("SSR 令牌只序列化安全元数据，不含一次性明文或摘要", async () => {
  const created = await createToken(env, {
    name: "测试",
    scopes: ["posts:read"],
    expiresInDays: 30,
  });
  const result = await loadIntegrationsPageData(context());
  expect(result.initialTokens[0].id).toBe(created.id);
  expect(result.initialError).toBe("");
  expect(JSON.stringify(result)).not.toContain(created.token);
  expect(Object.keys(result.initialTokens[0]).sort()).toEqual(
    ["id", "name", "scopes", "createdAt", "expiresAt", "lastUsedAt"].sort(),
  );
});
