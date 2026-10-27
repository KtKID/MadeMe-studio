import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAPI } from "../../src/server/api";
import { readSettings, writeSettings } from "../../src/server/settings";
import { loadConfig } from "../../src/modules/config/server";
import { buildRss } from "../../src/server/discovery/feed";
import { fixtureEnv } from "./support";
import type { Post } from "../../src/shared/contracts";

let env: ReturnType<typeof fixtureEnv>;
beforeEach(() => {
  env = fixtureEnv();
});
afterEach(() => {
  env.DB.close();
  vi.restoreAllMocks();
});
function call(
  path: string,
  { method = "GET", body, owner = true }: { method?: string; body?: unknown; owner?: boolean } = {},
) {
  const isForm = body instanceof FormData;
  return handleAPI({
    request: new Request(`https://site.test/api/${path}`, {
      method,
      headers: {
        Origin: "https://site.test",
        ...(isForm || body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(owner ? { "oai-authenticated-user-id": "test-owner" } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    }),
    locals: { env },
  });
}
async function storedLimits() {
  const row = await env.DB.prepare(
    "SELECT json_extract(document_json,'$.limits') AS limits FROM settings WHERE id=1",
  ).first<{ limits: string | null }>();
  return row?.limits ? JSON.parse(row.limits) : null;
}

describe("配置读写：D1 只保存改过的项", () => {
  it("保存一项后读回生效，恢复默认（null）后删除该键", async () => {
    await writeSettings(env, { limits: { upload: { videoMaxMB: 40 } } });
    expect(await storedLimits()).toEqual({ upload: { videoMaxMB: 40 } });
    expect((await loadConfig(env)).upload.videoMaxMB).toBe(40);
    expect((await readSettings(env)).limits.upload.imageMaxMB).toBe(25);
    await writeSettings(env, { limits: { upload: { videoMaxMB: null } } });
    expect(await storedLimits()).toEqual({ upload: {} });
    expect((await loadConfig(env)).upload.videoMaxMB).toBe(25);
  });
  it("越界与跨字段问题返回 422 中文原因，不写入", async () => {
    const tooBig = await call("settings", {
      method: "PATCH",
      body: { limits: { upload: { videoMaxMB: 51 } } },
    });
    expect(tooBig.status).toBe(422);
    expect(JSON.stringify(await tooBig.json())).toContain("不能大于 50 MB");
    const cross = await call("settings", {
      method: "PATCH",
      body: { limits: { security: { tokenMaxDays: 30 } } },
    });
    expect(cross.status).toBe(422);
    expect(JSON.stringify(await cross.json())).toContain("不能超过");
    expect((await loadConfig(env)).security.tokenMaxDays).toBe(365);
  });
  it("D1 里被手改的越界值读取时夹紧，不会让站点挂掉", async () => {
    await writeSettings(env, { siteTitle: "x" });
    await env.DB.prepare(
      "UPDATE settings SET document_json=json_set(document_json,'$.limits',json('{\"upload\":{\"videoMaxMB\":9999},\"ai\":\"bad\"}')) WHERE id=1",
    ).run();
    const config = await loadConfig(env);
    expect(config.upload.videoMaxMB).toBe(50);
    expect(config.ai.textPerMinute).toBe(20);
  });
});

describe("服务端按配置执行", () => {
  it("上传：禁用的类型 415、超过按类型上限 413", async () => {
    await writeSettings(env, {
      limits: { upload: { imageMaxMB: 1, disabledTypes: ["image/gif"] } },
    });
    const gif = new FormData();
    gif.append("file", new Blob([new Uint8Array([71, 73, 70, 56, 57, 97])], { type: "image/gif" }), "a.gif");
    const disabled = await call("media", { method: "POST", body: gif });
    expect(disabled.status).toBe(415);
    expect(JSON.stringify(await disabled.json())).toContain("关闭");
    const png = new FormData();
    const bytes = new Uint8Array(1024 * 1024 + 10);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.append("file", new Blob([bytes], { type: "image/png" }), "a.png");
    const big = await call("media", { method: "POST", body: png });
    expect(big.status).toBe(413);
  });
  it("令牌：未填有效期用配置默认值，超过最长有效期 422", async () => {
    await writeSettings(env, {
      limits: { security: { tokenDefaultDays: 7, tokenMaxDays: 30 } },
    });
    const created = await call("tokens", {
      method: "POST",
      body: { name: "cli", scopes: ["posts:write"] },
    });
    expect(created.status).toBe(201);
    const token = (await created.json()) as { expiresAt: string };
    const days = (Date.parse(token.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const tooLong = await call("tokens", {
      method: "POST",
      body: { name: "cli", scopes: ["posts:write"], expiresInDays: 31 },
    });
    expect(tooLong.status).toBe(422);
    expect(JSON.stringify(await tooLong.json())).toContain("30");
  });
  it("部署信息：仅作者可读，只含是否已配置", async () => {
    expect((await call("deployment", { owner: false })).status).toBe(401);
    const response = await call("deployment");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(env.SESSION_SECRET!);
    const { deployment } = JSON.parse(text) as {
      deployment: { key: string; configured: boolean }[];
    };
    expect(deployment.find((i) => i.key === "sessionSecret")?.configured).toBe(true);
  });
  it("RSS 按配置条数截取最近发布的文章", () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      title: `第 ${i} 篇`,
      excerpt: "",
      status: "published",
      visibility: "public",
      publishedAt: `2026-10-0${i + 1}T00:00:00.000Z`,
      updatedAt: `2026-10-0${i + 1}T00:00:00.000Z`,
      deletedAt: null,
      tags: [],
      blocks: [],
    })) as unknown as Post[];
    const rss = buildRss("https://site.test", "站点", posts, 2);
    expect(rss.match(/<item>/g)).toHaveLength(2);
    expect(rss).toContain("第 4 篇");
    expect(rss).not.toContain("第 0 篇");
  });
});
