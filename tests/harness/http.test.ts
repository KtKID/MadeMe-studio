import { afterEach, expect, it } from "vitest";
import { request as nodeRequest, type Server } from "node:http";
import { once } from "node:events";
import { createHarnessHTTP } from "../../integrations/codex-harness/http";
let servers: Server[] = [];
afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  servers = [];
});
const runner: any = {
  status: async () => ({
    connected: true,
    authenticated: false,
    browserLoginAvailable: true,
    capabilities: { polishSelection: true, imageGeneration: true },
  }),
  create: async () => {
    throw Error("should not run");
  },
};
async function fixture() {
  const server = createHarnessHTTP(runner, {
    pairCode: "test-only-pair-code",
    pairExpiresAt: Date.now() + 60_000,
  });
  server.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  return { server, origin };
}
it("真实本地HTTP：未配对拒绝；同源单次配对换HttpOnly session；重放拒绝", async () => {
  const { origin } = await fixture();
  expect((await fetch(origin + "/v1/status")).status).toBe(401);
  const pair = await fetch(origin + "/v1/pair", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "test-only-pair-code" }),
  });
  expect(pair.status).toBe(200);
  const cookie = pair.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(
    (
      await fetch(origin + "/v1/status", {
        headers: { Cookie: cookie.split(";")[0] },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await fetch(origin + "/v1/pair", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ code: "test-only-pair-code" }),
      })
    ).status,
  ).toBe(401);
});
it("跨站Origin、伪造Host和非JSON mutation拒绝，不允许CORS", async () => {
  const { origin } = await fixture();
  const request = (headers: Record<string, string>) =>
    fetch(origin + "/v1/pair", {
      method: "POST",
      headers,
      body: JSON.stringify({ code: "test-only-pair-code" }),
    });
  expect(
    (
      await request({
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      })
    ).status,
  ).toBe(403);
  const hostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = nodeRequest(
        origin + "/v1/pair",
        {
          method: "POST",
          headers: {
            Origin: origin,
            Host: "evil.test",
            "Content-Type": "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ code: "test-only-pair-code" }));
    },
  );
  expect(hostStatus).toBe(403);
  expect(
    (await request({ Origin: origin, "Content-Type": "text/plain" })).status,
  ).toBe(415);
  expect(
    (await fetch(origin + "/v1/status")).headers.get(
      "access-control-allow-origin",
    ),
  ).toBeNull();
});
it("缺授权配置不允许构建HTTP服务", () => {
  expect(() => createHarnessHTTP(runner, {})).toThrow();
});
it("过期配对码拒绝", async () => {
  const server = createHarnessHTTP(runner, {
    pairCode: "expired",
    pairExpiresAt: 0,
  });
  server.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  expect(
    (
      await fetch(origin + "/v1/pair", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: '{"code":"expired"}',
      })
    ).status,
  ).toBe(401);
});
it("审计只记录归一化操作和状态，不包含配对code/query/请求正文", async () => {
  const records: unknown[] = [];
  const server = createHarnessHTTP(runner, {
    pairCode: "test-audit-secret",
    pairExpiresAt: Date.now() + 60_000,
    audit: (e) => records.push(e),
  });
  server.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  await fetch(origin + "/v1/pair?token=secret-query", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "test-audit-secret" }),
  });
  expect(records).toHaveLength(1);
  expect(JSON.stringify(records)).not.toMatch(
    /test-audit-secret|secret-query|token|code/,
  );
  expect(records[0]).toMatchObject({ operation: "pair", status: 200 });
});
it("API key仅已配对同源页面可提交，Bearer或缺Origin拒绝，审计与响应不回显", async () => {
  let configured = 0;
  const records: unknown[] = [];
  const local = {
    ...runner,
    setApiKey: async (input: { apiKey: string }) => {
      expect(input.apiKey).toBe("sk-fixture-only");
      configured++;
      return { ok: true };
    },
  };
  const server = createHarnessHTTP(local, {
    pairCode: "pair-for-key-test",
    pairExpiresAt: Date.now() + 60_000,
    bearerToken: "x".repeat(32),
    audit: (event) => records.push(event),
  });
  server.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const send = (headers: Record<string, string>) =>
    fetch(origin + "/v1/auth/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ apiKey: "sk-fixture-only" }),
    });
  expect(
    (await send({ Authorization: "Bearer " + "x".repeat(32) })).status,
  ).toBe(403);
  const paired = await fetch(origin + "/v1/pair", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "pair-for-key-test" }),
  });
  const cookie = paired.headers.get("set-cookie")!.split(";")[0];
  expect((await send({ Cookie: cookie })).status).toBe(403);
  const accepted = await send({ Origin: origin, Cookie: cookie });
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ ok: true });
  expect(configured).toBe(1);
  expect(JSON.stringify(records)).not.toContain("sk-fixture-only");
});
