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
// 工作台 SSR 列表契约：正文不再进入列表岛屿，私有资源首屏已有数据。
const dashboardResponse = await fetch(base + "/studio");
assert.equal(dashboardResponse.status, 200);
assert.match(
  dashboardResponse.headers.get("Cache-Control"),
  /private.*no-store/,
);
const dashboardHTML = await dashboardResponse.text();
assert.ok(dashboardHTML.includes("不应出现在阅读页的草稿标题"));
assert.ok(!dashboardHTML.includes("已发布正文"));
const mediaPage = await fetch(base + "/studio/media");
assert.equal(mediaPage.status, 200);
const mediaHTML = await mediaPage.text();
assert.ok(mediaHTML.includes("valid-image.png"));
assert.ok(mediaHTML.includes("initialMedia"));
const integrationPage = await fetch(base + "/studio/integrations");
assert.equal(integrationPage.status, 200);
assert.ok((await integrationPage.text()).includes("initialTokens"));
const readerMedia = await fetch("http://127.0.0.1:4322/studio/media");
assert.ok(!(await readerMedia.text()).includes("valid-image.png"));
const original = readFileSync(
  new URL("../fixtures/valid-image.png", import.meta.url),
);
const downloaded = await fetch(base + media.url);
assert.equal(downloaded.status, 200);
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
// 真实 workerd/R2 范围读取：验证 size 是完整对象大小，而正文只含所选字节。
for (const [range, start, end] of [
  ["bytes=0-7", 0, 7],
  [`bytes=${original.length - 5}-`, original.length - 5, original.length - 1],
  ["bytes=-4", original.length - 4, original.length - 1],
]) {
  const partial = await fetch(base + media.url, { headers: { Range: range } });
  assert.equal(partial.status, 206);
  assert.equal(
    partial.headers.get("Content-Range"),
    `bytes ${start}-${end}/${original.length}`,
  );
  assert.equal(partial.headers.get("Content-Length"), String(end - start + 1));
  assert.equal(partial.headers.get("Accept-Ranges"), "bytes");
  assert.equal(partial.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    original.subarray(start, end + 1),
  );
}
const head = await fetch(base + media.url, {
  method: "HEAD",
  headers: { Range: "bytes=0-1" },
});
assert.equal(head.status, 200);
assert.equal(head.headers.get("Content-Length"), String(original.length));
assert.equal(head.headers.get("Content-Range"), null);
assert.equal((await head.arrayBuffer()).byteLength, 0);
const unsatisfiable = await fetch(base + media.url, {
  headers: { Range: `bytes=${original.length}-` },
});
assert.equal(unsatisfiable.status, 416);
assert.equal(
  unsatisfiable.headers.get("Content-Range"),
  `bytes */${original.length}`,
);
assert.equal(unsatisfiable.headers.get("Cache-Control"), "private, no-store");
assert.equal((await unsatisfiable.arrayBuffer()).byteLength, 0);
// 仅上传并关联 postId 不等于发布引用，访客不得读取或探测媒体长度。
for (const method of ["GET", "HEAD"]) {
  const denied = await fetch("http://127.0.0.1:4322" + media.url, {
    method,
    headers: { Range: `bytes=${original.length}-` },
  });
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("Content-Range"), null);
}
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
  "真实 Worker/D1/R2 HTTP 端到端通过：建文、发布快照、版本409、有效PNG上传下载及R2范围/HEAD/416/私有长度隔离、缺模型错误、删除恢复、访客隔离。",
);
