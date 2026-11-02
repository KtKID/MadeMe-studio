import test from "node:test";
import assert from "node:assert/strict";
import {
  createDraftWithAttachments,
  uploadAttachment,
} from "../shared/client.ts";

const token = `mm_${"a".repeat(64)}`;
const base = {
  site: "https://writer.example",
  token,
  title: "Test",
  markdown: "![[test.mp4]]",
  assets: [
    {
      path: "test.mp4",
      file: new File(["video"], "test.mp4", { type: "video/mp4" }),
    },
  ],
  resolve: { mode: "selected" },
};
const media = {
  id: "test-id",
  url: "/api/files/test-id",
  name: "test.mp4",
  mime: "video/mp4",
  size: 5,
  postId: null,
  source: "upload",
  createdAt: "2026-11-01T00:00:00.000Z",
};
test("附件→草稿使用同源固定 API / Zod / 禁重定向，视频不是图片", async () => {
  const calls = [];
  const result = await createDraftWithAttachments({
    ...base,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (url.endsWith("/api/media")) {
        assert.ok(init.body instanceof FormData);
        return Response.json({ media }, { status: 201 });
      }
      const body = JSON.parse(init.body);
      assert.equal(body.visibility, "draft");
      assert.equal(body.blocks[0].type, "video");
      assert.equal(body.blocks[0].props.url, media.url);
      assert.equal(body.markdown, undefined);
      return Response.json(
        { post: { id: "draft-id", version: 1 } },
        { status: 201 },
      );
    },
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://writer.example/api/media", "https://writer.example/api/posts"],
  );
  assert.equal(result.visibility, "draft");
});
test("缺附件、不支持、失败、取消不创建文章；响应和网络错误不泄露 token", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Error(token);
  };
  await assert.rejects(
    createDraftWithAttachments({ ...base, assets: [], fetchImpl }),
    /缺少/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    createDraftWithAttachments({ ...base, fetchImpl }),
    (error) => !error.message.includes(token),
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createDraftWithAttachments({
      ...base,
      signal: controller.signal,
      fetchImpl,
    }),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    uploadAttachment({
      ...base,
      file: base.assets[0].file,
      fetchImpl: async () =>
        Response.json({ error: { message: token } }, { status: 403 }),
    }),
    (error) => !error.message.includes(token) && error.message.includes("403"),
  );
  await assert.rejects(
    createDraftWithAttachments({
      ...base,
      fetchImpl: async () =>
        Response.json({
          media: { ...media, url: "https://evil.example/file" },
        }),
    }),
    /无效的本站/,
  );
});
test("插件惰性读取逐个附件，失败重试使用同一预览缓存，不重复读取/上传", async () => {
  let reads = 0,
    uploads = 0;
  const cache = new Map();
  const options = {
    ...base,
    cache,
    readAttachment: async (asset) => {
      reads++;
      return asset.file;
    },
    fetchImpl: async (url) => {
      if (url.endsWith("/api/media")) {
        uploads++;
        return Response.json({ media }, { status: 201 });
      }
      throw Error("post failed");
    },
  };
  await assert.rejects(createDraftWithAttachments(options));
  await assert.rejects(createDraftWithAttachments(options));
  assert.equal(reads, 1);
  assert.equal(uploads, 1);
});
