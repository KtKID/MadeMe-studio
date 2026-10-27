import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureEnv, blocks } from "./backend/support";
import * as identity from "../src/server/auth/identity";
import * as media from "../src/server/media/service";
import * as tokens from "../src/server/tokens";
import { PostService } from "../src/server/content/service";
import { D1PostRepository } from "../src/server/content/repository";
import { loadStudioPageData } from "../src/server/page-data";
let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
  Object.assign(env, {
    ENVIRONMENT: "development",
    ALLOW_LOCAL_DEV_IDENTITY: "true",
    DEV_OWNER_ID: "test-owner",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.DB.close();
});
const context = () => ({
  request: new Request("http://localhost/studio/settings"),
  locals: { env },
});
it("工作台只核验一次身份，摘要、媒体和安全令牌元数据共享引导", async () => {
  await new PostService(new D1PostRepository(env.DB)).create({
    title: "私有草稿",
    blocks,
  });
  const token = await tokens.createToken(env, {
    name: "测试",
    scopes: ["posts:read"],
    expiresInDays: 30,
  });
  const auth = vi.spyOn(identity, "authenticate");
  const prepare = vi.spyOn(env.DB, "prepare");
  const result = await loadStudioPageData(context());
  expect(auth).toHaveBeenCalledTimes(1);
  expect(result.trustedIdentity).toBe("test-owner");
  expect(result.posts[0].title).toBe("私有草稿");
  expect(result.posts[0]).not.toHaveProperty("blocks");
  expect(result.initialTokens[0].id).toBe(token.id);
  expect(JSON.stringify(result)).not.toContain(token.token);
  expect(JSON.stringify(result)).not.toContain("token_hash");
  expect(
    prepare.mock.calls.filter(([sql]) => /FROM settings/.test(sql)),
  ).toHaveLength(1);
});
it("访客不读取任何私有列表，包括草稿摘要", async () => {
  env.ALLOW_LOCAL_DEV_IDENTITY = "false";
  const spy = vi.spyOn(env.DB, "prepare");
  const result = await loadStudioPageData(context());
  expect(result.capabilities.authenticated).toBe(false);
  expect(result.posts).toEqual([]);
  expect(result.initialMedia).toEqual([]);
  expect(result.initialTokens).toEqual([]);
  expect(
    spy.mock.calls.some(([sql]) => /FROM (posts|media|api_tokens)/.test(sql)),
  ).toBe(false);
});
it("三个资源并行开始，单个失败不吞掉其余结果或泄漏内部异常", async () => {
  let resolveMedia!: (value: []) => void;
  const mediaCall = vi.spyOn(media, "listMedia").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveMedia = resolve;
      }),
  );
  const tokenCall = vi
    .spyOn(tokens, "listTokens")
    .mockRejectedValue(new Error("private database detail"));
  const postsCall = vi
    .spyOn(D1PostRepository.prototype, "listSummaries")
    .mockResolvedValue([]);
  const pending = loadStudioPageData(context());
  await vi.waitFor(() => expect(tokenCall).toHaveBeenCalledTimes(1));
  expect(mediaCall).toHaveBeenCalledTimes(1);
  expect(postsCall).toHaveBeenCalledTimes(1);
  resolveMedia([]);
  const result = await pending;
  expect(result.mediaError).toBe("");
  expect(result.postsError).toBe("");
  expect(result.tokensError).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain("private database detail");
});
it("无数据库时已授权页面显示独立错误而不是空列表成功", async () => {
  const result = await loadStudioPageData({
    ...context(),
    locals: { env: { ...env, DB: undefined } },
  });
  expect(result.postsError).toBeTruthy();
  expect(result.mediaError).toBeTruthy();
  expect(result.tokensError).toBeTruthy();
});

it("身份未完成前不启动任何私有查询，拒绝身份后也不启动", async () => {
  let finishIdentity!: (value: identity.Identity) => void;
  vi.spyOn(identity, "authenticate").mockImplementation(
    () =>
      new Promise((resolve) => {
        finishIdentity = resolve;
      }),
  );
  const mediaCall = vi.spyOn(media, "listMedia");
  const tokenCall = vi.spyOn(tokens, "listTokens");
  const postsCall = vi.spyOn(D1PostRepository.prototype, "listSummaries");
  const pending = loadStudioPageData(context());
  await Promise.resolve();
  expect(mediaCall).not.toHaveBeenCalled();
  expect(tokenCall).not.toHaveBeenCalled();
  expect(postsCall).not.toHaveBeenCalled();
  finishIdentity({ owner: false, trustedIdentity: "not-owner", scopes: [] });
  const result = await pending;
  expect(result.capabilities.authenticated).toBe(false);
  expect(mediaCall).not.toHaveBeenCalled();
  expect(tokenCall).not.toHaveBeenCalled();
  expect(postsCall).not.toHaveBeenCalled();
});
