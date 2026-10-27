import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveMedia, serveMedia } from "../../src/server/media/service";
import { handleAPI } from "../../src/server/api";
import { fixtureEnv } from "./support";

let env: ReturnType<typeof fixtureEnv>;
let id: string;
const owner = { owner: true, trustedIdentity: "test-owner", scopes: [] };
const bytes = new TextEncoder().encode("ID30123456789");
beforeEach(async () => {
  env = fixtureEnv();
  id = (await saveMedia(env, bytes, { name: "测试.mp3", mime: "audio/mpeg" }))
    .id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.DB.close();
});
function read(range?: string, method = "GET", extra = {}) {
  return serveMedia(
    new Request(`https://test/api/media/${id}`, {
      method,
      headers: { ...(range ? { Range: range } : {}), ...extra },
    }),
    env,
    owner,
    id,
  );
}
it.each([
  ["bytes=2-5", 2, 5],
  ["bytes=5-", 5, 12],
  ["bytes=-4", 9, 12],
  ["bytes=10-999", 10, 12],
  ["bytes=-999", 0, 12],
  ["bytes=0-0", 0, 0],
])("流式读取单范围 %s", async (range, start, end) => {
  const get = vi.spyOn(env.BUCKET, "get");
  const response = await read(String(range));
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe(
    `bytes ${start}-${end}/13`,
  );
  expect(response.headers.get("Content-Length")).toBe(
    String(Number(end) - Number(start) + 1),
  );
  expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    bytes.slice(Number(start), Number(end) + 1),
  );
  expect(get).toHaveBeenCalledWith(`media/${id}`, {
    range: { offset: start, length: Number(end) - Number(start) + 1 },
  });
});
it.each(["bytes=13-", "bytes=-0", "bytes=999999999999999999999-"])(
  "不可满足范围 %s 返回416",
  async (range) => {
    const get = vi.spyOn(env.BUCKET, "get");
    const response = await read(range);
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */13");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
  },
);
it.each([undefined, "bytes=5-2", "bytes=wat", "bytes=0-1,4-5", "items=0-1"])(
  "忽略不支持或非法范围 %s",
  async (range) => {
    const response = await read(range);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  },
);
it("未提供验证器时If-Range回退完整响应", async () => {
  expect(
    (await read("bytes=0-1", "GET", { "If-Range": '"unknown"' })).status,
  ).toBe(200);
});
it("HEAD忽略Range并无响应正文", async () => {
  const response = await read("bytes=0-1", "HEAD");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Length")).toBe("13");
  expect(await response.text()).toBe("");
});
it("无权访问时先404，不读对象或泄露长度", async () => {
  const get = vi.spyOn(env.BUCKET, "get");
  await expect(
    serveMedia(
      new Request(`https://test/api/media/${id}`, {
        headers: { Range: "bytes=999-" },
      }),
      env,
      { owner: false, trustedIdentity: null, scopes: [] },
      id,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(get).not.toHaveBeenCalled();
});

it("实际R2长度优先于过期的D1大小", async () => {
  await env.DB.prepare("UPDATE media SET size=999 WHERE id=?").bind(id).run();
  const response = await read("bytes=10-");
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 10-12/13");
  expect(await response.text()).toBe("789");
});
it("HEAD未授权同样404且不读R2元数据", async () => {
  const head = vi.spyOn(env.BUCKET, "head");
  const get = vi.spyOn(env.BUCKET, "get");
  await expect(
    serveMedia(
      new Request(`https://test/api/media/${id}`, { method: "HEAD" }),
      env,
      { owner: false, trustedIdentity: null, scopes: [] },
      id,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(head).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});
it("授权前不读Range元数据", async () => {
  const head = vi.spyOn(env.BUCKET, "head");
  await expect(
    serveMedia(
      new Request(`https://test/api/media/${id}`, {
        headers: { Range: "bytes=999-" },
      }),
      env,
      { owner: false, trustedIdentity: null, scopes: [] },
      id,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(head).not.toHaveBeenCalled();
});
it("对象在head和get之间变更时拒绝错误的部分响应", async () => {
  vi.spyOn(env.BUCKET, "head").mockResolvedValue({ size: 20 });
  await expect(read("bytes=0-1")).rejects.toMatchObject({
    status: 503,
    code: "MEDIA_CHANGED",
  });
});

it("超长Range忽略为完整响应", async () => {
  expect((await read(`bytes=${"9".repeat(1025)}-`)).status).toBe(200);
});
it.each(["GET", "HEAD"])("API入口%s保留范围和权限语义", async (method) => {
  const response = await handleAPI({
    request: new Request(`https://test/api/files/${id}`, {
      method,
      headers: {
        "oai-authenticated-user-id": "test-owner",
        Range: "bytes=0-1",
      },
    }),
    locals: { env },
  });
  expect(response.status).toBe(method === "GET" ? 206 : 200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).toBe(method === "GET" ? "ID" : "");
  const denied = await handleAPI({
    request: new Request(`https://test/api/files/${id}`, {
      method,
      headers: { Range: "bytes=999-" },
    }),
    locals: { env },
  });
  expect(denied.status).toBe(404);
  expect(denied.headers.get("Content-Range")).toBeNull();
});
