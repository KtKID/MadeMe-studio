import { afterEach, beforeEach, expect, it } from "vitest";
import { D1PostRepository } from "../../src/server/content/repository";
import { PostService } from "../../src/server/content/service";
import { fixtureEnv, blocks } from "./support";
let env: ReturnType<typeof fixtureEnv>;
let posts: PostService;
beforeEach(() => {
  env = fixtureEnv();
  posts = new PostService(new D1PostRepository(env.DB));
});
afterEach(() => env.DB.close());
it("CID 占用包含回收站，并发保存以唯一索引兜底；发布快照不包含 CID", async () => {
  const first = await posts.create({ title: "一", blocks, cid: "c-test" });
  const second = await posts.create({ title: "二", blocks });
  await expect(
    posts.update(second.id, { version: 1, cid: "c-test" }),
  ).rejects.toMatchObject({ code: "CID_CONFLICT" });
  await posts.publish(first.id, { version: 1 });
  expect((await posts.mustGet(first.id)).published).not.toHaveProperty("cid");
  await posts.remove(first.id, 2);
  await expect(
    posts.update(second.id, { version: 1, cid: "c-test" }),
  ).rejects.toMatchObject({ code: "CID_CONFLICT" });
});

it("真实 API 对管理员开放 CID，公开读取和令牌响应均隐藏", async () => {
  const { handleAPI } = await import("../../src/server/api");
  const { createToken } = await import("../../src/server/tokens");
  const invoke = (
    path: string,
    method: string,
    identity: "owner" | "public" | string,
    body?: object,
  ) =>
    handleAPI({
      request: new Request(`https://site.test/api/${path}`, {
        method,
        headers: {
          Origin: "https://site.test",
          "Content-Type": "application/json",
          ...(identity === "owner"
            ? { "oai-authenticated-user-id": "test-owner" }
            : identity === "public"
              ? {}
              : {
                  Authorization: `Bearer ${identity}`,
                  Accept: "application/json; mademe-post-schema=2",
                }),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      locals: { env },
    });
  const created = await invoke("posts", "POST", "owner", {
    title: "测试",
    blocks,
    cid: "c-private",
  });
  expect(created.status).toBe(201);
  const { post } = (await created.json()) as { post: { id: string } };
  expect(
    (await invoke("posts/cid-check", "POST", "owner", { cid: "c-private" }))
      .status,
  ).toBe(409);
  expect(
    (
      await invoke("posts/cid-check", "POST", "owner", {
        cid: "c-private",
        postId: post.id,
      })
    ).status,
  ).toBe(200);
  const token = await createToken(env, {
    name: "test",
    scopes: ["posts:read", "posts:write"],
    expiresInDays: 1,
  });
  expect(
    (await invoke("posts/cid-check", "POST", token.token, { cid: "c-private" }))
      .status,
  ).toBe(403);
  expect(
    await (await invoke(`posts/${post.id}`, "GET", token.token)).text(),
  ).not.toContain("c-private");
  expect(
    (
      await invoke("posts", "POST", token.token, {
        title: "x",
        blocks,
        cid: "c-other",
      })
    ).status,
  ).toBe(403);
  await invoke(`posts/${post.id}/publish`, "POST", "owner", { version: 1 });
  expect(
    await (await invoke(`posts/${post.id}`, "GET", "public")).text(),
  ).not.toContain("c-private");
});

it("两篇草稿同时保存同一 CID，数据库只提交一篇并且失败不产生修订", async () => {
  const first = await posts.create({ title: "甲", blocks });
  const second = await posts.create({ title: "乙", blocks });
  const repo = posts.repository as D1PostRepository;
  // 两边均在保存前完成预检，随后同时尝试提交。
  expect(
    await Promise.all([repo.byCid("c-race"), repo.byCid("c-race")]),
  ).toEqual([null, null]);
  // D1 按事务序列化写入；测试适配器也排队 batch，防止同一 SQLite 连接嵌套 BEGIN。
  const batch = env.DB.batch.bind(env.DB);
  let queue: Promise<unknown> = Promise.resolve();
  env.DB.batch = (statements) => {
    const pending = queue.then(() => batch(statements));
    queue = pending.catch(() => undefined);
    return pending;
  };
  const outcomes = await Promise.allSettled([
    posts.update(first.id, { version: 1, cid: "c-race" }),
    posts.update(second.id, { version: 1, cid: "c-race" }),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failed = outcomes.find((result) => result.status === "rejected");
  expect(failed).toMatchObject({
    status: "rejected",
    reason: { status: 409, code: "CID_CONFLICT" },
  });
  const rows = await Promise.all([
    posts.mustGet(first.id),
    posts.mustGet(second.id),
  ]);
  expect(rows.filter((row) => row.draft.cid === "c-race")).toHaveLength(1);
  const loser = rows.find((row) => !row.draft.cid)!;
  expect(await repo.revisions(loser.draft.id)).toHaveLength(1);
});
