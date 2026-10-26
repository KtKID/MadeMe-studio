import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = "http://127.0.0.1:4321";
async function api(path, method = "GET", body, reader = false) {
  const origin = reader ? "http://127.0.0.1:4322" : base;
  const headers = { Origin: origin };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(origin + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();

  return { response, data };
}
const initial = await api("/api/bootstrap");
assert.equal(initial.response.status, 200);
assert.equal(initial.data.capabilities.authenticated, true);
const created = await api("/api/posts", "POST", {
  title: "Worker 端到端示例",
  blocks: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "已发布正文", styles: {} }],
    },
  ],
});
assert.equal(created.response.status, 201);
let post = created.data.post;
const published = await api(`/api/posts/${post.id}/publish`, "POST", {
  version: post.version,
  visibility: "public",
});
assert.equal(published.response.status, 200);
post = published.data.post;
const changed = await api(`/api/posts/${post.id}`, "PATCH", {
  version: post.version,
  title: "不应出现在阅读页的草稿标题",
});
assert.equal(changed.response.status, 200);
post = changed.data.post;
const page = await fetch(`${base}/p/${post.slug}`);
assert.equal(page.status, 200);
const html = await page.text();
assert.ok(html.includes("Worker 端到端示例"));
assert.ok(!html.includes("不应出现在阅读页的草稿标题"));
const stale = await api(`/api/posts/${post.id}`, "PATCH", {
  version: 1,
  title: "旧版本",
});
assert.equal(stale.response.status, 409);
const form = new FormData();
form.append(
  "file",
  new Blob(
    [readFileSync(new URL("../fixtures/valid-image.png", import.meta.url))],
    { type: "image/png" },
  ),
  "valid-image.png",
);
form.append("postId", post.id);
const uploaded = await fetch(base + "/api/media", {
  method: "POST",
  headers: { Origin: base },
  body: form,
});
assert.equal(uploaded.status, 201);
const { media } = await uploaded.json();
const downloaded = await fetch(base + media.url);
assert.equal(downloaded.status, 200);
assert.equal(
  (await downloaded.arrayBuffer()).byteLength,
  readFileSync(new URL("../fixtures/valid-image.png", import.meta.url))
    .byteLength,
);
const unconfigured = await api("/api/ai", "POST", {
  action: "polish",
  selection: "测试",
});
assert.equal(unconfigured.response.status, 503);
const deleted = await api(`/api/posts/${post.id}`, "DELETE", {
  version: post.version,
});
assert.equal(deleted.response.status, 200);
post = deleted.data.post;
const restored = await api(`/api/posts/${post.id}/restore`, "POST", {
  version: post.version,
});
assert.equal(restored.response.status, 200);
const visitor = await api("/api/bootstrap", "GET", undefined, true);
assert.equal(visitor.data.capabilities.authenticated, false);
assert.ok(
  visitor.data.posts.every((p) => p.title !== "不应出现在阅读页的草稿标题"),
);
console.log(
  "真实 Worker/D1/R2 HTTP 端到端通过：建文、发布快照、版本409、有效PNG上传下载、缺模型错误、删除恢复、访客隔离。",
);
