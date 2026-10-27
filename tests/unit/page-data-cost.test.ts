import { expect, it, vi } from "vitest";
import { loadPageData } from "../../src/server/page-data";

it("仅加载后台外壳时不读取文章正文", async () => {
  const first = vi.fn().mockResolvedValue(null);
  const all = vi.fn().mockResolvedValue({ results: [] });
  const prepare = vi.fn((_sql: string) => ({ first, all }));
  const data = await loadPageData(
    {
      request: new Request("https://site.test/studio/settings"),
      locals: { env: { DB: { prepare } } },
    },
    false,
    { posts: "none" },
  );
  expect(data.posts).toEqual([]);
  expect(prepare.mock.calls.map((c) => c[0])).toEqual([
    "SELECT document_json FROM settings WHERE id=1",
  ]);
  expect(all).not.toHaveBeenCalled();
});
it("编辑页只查询指定文章且非作者不读取草稿", async () => {
  const first = vi.fn().mockResolvedValue(null);
  const all = vi.fn().mockResolvedValue({ results: [] });
  const bind = vi.fn((_sql: string) => ({ first }));
  const prepare = vi.fn((_sql: string) => ({ first, all, bind }));
  const context = {
    request: new Request("https://site.test/studio/edit?id=post-1", {
      headers: { "oai-authenticated-user-id": "owner" },
    }),
    locals: { env: { DB: { prepare }, AUTH_MODE: "sites", OWNER_ID: "owner" } },
  };
  await loadPageData(context, false, { posts: "single", id: "post-1" });
  expect(bind).toHaveBeenCalledWith("post-1");
  expect(all).not.toHaveBeenCalled();
  prepare.mockClear();
  bind.mockClear();
  await loadPageData(
    {
      ...context,
      request: new Request("https://site.test/studio/edit?id=post-1"),
    },
    false,
    { posts: "single", id: "post-1" },
  );
  expect(bind).not.toHaveBeenCalled();
});
