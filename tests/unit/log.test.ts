import { afterEach, describe, expect, it, vi } from "vitest";
import {
  log,
  logCaught,
  logger,
  requestLogContext,
} from "../../src/server/log";
import { redact, serializeError } from "../../src/shared/log-redact";
import { errorResponse } from "../../src/server/http";
import { AppError } from "../../src/server/errors";
import { verifyPassword } from "../../src/server/auth/crypto";
import { saveMedia } from "../../src/server/media/service";
import {
  clientCaught,
  clientLog,
} from "../../src/components/shared/client-log";
import { captureLogs } from "../backend/log-capture";
import { z } from "zod";

afterEach(() => vi.restoreAllMocks());

describe("统一日志：格式与级别", () => {
  it("每条日志是一行 JSON，含 level/event/ts 与上下文字段", () => {
    const logs = captureLogs();
    logger.info("unit.sample", { stage: "token", count: 2 });
    const [record] = logs.records();
    expect(record).toMatchObject({
      level: "info",
      event: "unit.sample",
      stage: "token",
      count: 2,
    });
    expect(Date.parse(String(record.ts))).not.toBeNaN();
  });
  it.each([
    ["debug", "debug"],
    ["info", "log"],
    ["warn", "warn"],
    ["error", "error"],
  ] as const)("级别 %s 写入 console.%s", (level, method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => {});
    log(level, "unit.level");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][0] as string).level).toBe(level);
  });
  it("logCaught 默认 error 级别并附带序列化异常与堆栈", () => {
    const logs = captureLogs();
    logCaught("unit.caught", new TypeError("boom"), { stage: "x" });
    const [record] = logs.records();
    expect(record).toMatchObject({
      level: "error",
      event: "unit.caught",
      stage: "x",
      error: { name: "TypeError", message: "boom" },
    });
    expect((record.error as { stack?: string }).stack).toContain("TypeError");
  });
  it("请求关联使用 cf-ray，路径不含查询串", () => {
    const ctx = requestLogContext(
      new Request("https://a.test/api/auth/google/callback?code=c&state=s", {
        headers: { "cf-ray": "8abc123-SJC" },
      }),
    );
    expect(ctx).toEqual({
      requestId: "8abc123-SJC",
      method: "GET",
      path: "/api/auth/google/callback",
    });
    expect(requestLogContext(new Request("https://a.test/")).requestId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe("统一日志：强制脱敏", () => {
  const sensitive = {
    clientSecret: "s3cr3t-value",
    GOOGLE_CLIENT_SECRET: "s3cr3t-value",
    accessToken: "tok-value",
    id_token: "tok-value",
    code: "4/0AbCdEf-auth-code",
    state: "mm_state-value",
    nonce: "nonce-value",
    codeVerifier: "verifier-value",
    cookie: "__Host-mm_google_author=abc",
    authorization: "Bearer abc.def",
    sessionId: "session-value",
    password: "hunter2",
    email: "owner@example.test",
    body: '{"error":"raw provider"}',
    apiKey: "key-value",
  };
  it.each(Object.keys(sensitive))("敏感键 %s 被整体替换", (key) => {
    const out = redact({
      [key]: sensitive[key as keyof typeof sensitive],
    }) as Record<string, unknown>;
    expect(out[key]).toBe("[REDACTED]");
  });
  it("固定大写错误码与诊断字段保留", () => {
    expect(
      redact({ code: "CSRF_REJECTED", stage: "token", status: 403 }),
    ).toEqual({ code: "CSRF_REJECTED", stage: "token", status: 403 });
  });
  it("字符串值中的邮箱、Bearer、JWT、查询参数与长令牌被擦除", () => {
    const text = [
      "user owner@example.test",
      "Authorization: Bearer abcdefghijkl",
      "jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      "https://x.test/cb?code=4/0Abc&state=mm_xyz",
      `mm_${"a".repeat(64)}`,
      "sk_live_abcdefghijklmnop",
    ].join(" ");
    const logs = captureLogs();
    logger.warn("unit.scrub", { detail: text });
    const raw = logs.raw();
    for (const leak of [
      "owner@example.test",
      "abcdefghijkl",
      "eyJhbGciOiJSUzI1NiJ9",
      "4/0Abc",
      "mm_xyz",
      "a".repeat(64),
      "sk_live_abcdefghijklmnop",
    ])
      expect(raw).not.toContain(leak);
  });
  it("嵌套对象与数组同样脱敏，Request/Headers 不展开", () => {
    const logs = captureLogs();
    logger.info("unit.nested", {
      list: [{ token: "t1" }, { nested: { password: "p" } }],
      request: new Request("https://a.test", { headers: { cookie: "c=1" } }),
    });
    const raw = logs.raw();
    expect(raw).not.toContain("t1");
    expect(raw).not.toContain("c=1");
    expect(raw).toContain("[Request]");
  });
  it("异常消息同样被擦除", () => {
    const logs = captureLogs();
    logCaught("unit.err", new Error("failed for owner@example.test"));
    expect(logs.raw()).not.toContain("owner@example.test");
  });
});

describe("统一日志：异常序列化", () => {
  it("AppError 保留 name/message/code/status，不展开 details", () => {
    const out = serializeError(
      new AppError(503, "GOOGLE_UNAVAILABLE", "Unavailable", {
        secret: "x",
      }),
    );
    expect(out).toEqual({
      name: "AppError",
      message: "Unavailable",
      code: "GOOGLE_UNAVAILABLE",
      status: 503,
    });
  });
  it("非 Error 值与 cause 链可序列化", () => {
    expect(serializeError("plain").name).toBe("string");
    const out = serializeError(
      new Error("outer", { cause: new Error("inner") }),
    );
    expect(out.cause).toMatchObject({ message: "inner" });
  });
  it("非大写常量的 code（如 OAuth 授权码）不会被记录", () => {
    const e = Object.assign(new Error("x"), { code: "4/0Ab-secret" });
    expect(serializeError(e).code).toBeUndefined();
  });
});

describe("catch 路径必须写日志", () => {
  it("errorResponse：预期 4xx 只记录错误码，5xx/意外异常记录 error", async () => {
    const logs = captureLogs();
    const ctx = { requestId: "r1", method: "POST", path: "/api/x" };
    expect(
      errorResponse(new AppError(403, "CSRF_REJECTED", "no"), ctx).status,
    ).toBe(403);
    errorResponse(new AppError(404, "NOT_FOUND", "no"), ctx);
    errorResponse(z.object({ a: z.string() }).safeParse({}).error, ctx);
    errorResponse(new AppError(503, "GOOGLE_UNAVAILABLE", "x"), ctx);
    const res = errorResponse(new RangeError("db exploded"), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("db exploded");
    const records = logs.records();
    expect(records.map((r) => [r.level, r.event, r.code ?? null])).toEqual([
      ["warn", "request.rejected", "CSRF_REJECTED"],
      ["info", "request.rejected", "NOT_FOUND"],
      ["info", "request.rejected", "VALIDATION_ERROR"],
      ["error", "request.app_error", null],
      ["error", "request.unhandled_error", null],
    ]);
    expect(records[3].error).toMatchObject({ code: "GOOGLE_UNAVAILABLE" });
    expect(records[4]).toMatchObject({
      requestId: "r1",
      path: "/api/x",
      error: { name: "RangeError", message: "db exploded" },
    });
  });
  it("verifyPassword 的 KDF 异常不再静默返回 false", async () => {
    const logs = captureLogs();
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValueOnce(
      new Error("kdf down"),
    );
    expect(
      await verifyPassword(
        "pw",
        `pbkdf2:100000:${"00".repeat(16)}:${"0".repeat(64)}`,
      ),
    ).toBe(false);
    expect(logs.find("auth.post_password_verify_failed")).toHaveLength(1);
    expect(logs.raw()).not.toContain('"pw"');
  });
  it("媒体元数据失败时回滚失败被记录，且仍抛出原始错误", async () => {
    const logs = captureLogs();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const env = {
      DB: {
        prepare: () => ({
          bind() {
            return this;
          },
          run: () => Promise.reject(new Error("D1 insert failed")),
        }),
      },
      BUCKET: {
        put: async () => ({}),
        delete: () => Promise.reject(new Error("R2 delete failed")),
      },
    };
    await expect(
      saveMedia(env as never, png, { name: "a.png", mime: "image/png" }),
    ).rejects.toThrow("D1 insert failed");
    expect(logs.find("media.rollback_failed")[0]).toMatchObject({
      level: "error",
      error: { message: "R2 delete failed" },
    });
  });
});

describe("浏览器日志", () => {
  it("clientLog 以 [mademe] 前缀写控制台并脱敏", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    clientLog("warn", "api.request_failed", {
      path: "/api/posts",
      status: 401,
      token: "mm_secret",
    });
    expect(spy).toHaveBeenCalledWith("[mademe]", {
      event: "api.request_failed",
      path: "/api/posts",
      status: 401,
      token: "[REDACTED]",
    });
  });
  it("clientCaught 附带序列化异常", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    clientCaught("x.failed", new Error("bad"), {}, "error");
    expect(spy.mock.calls[0][1]).toMatchObject({
      event: "x.failed",
      error: { name: "Error", message: "bad" },
    });
  });
});

describe("浏览器 api() 失败路径写日志", () => {
  it("非 2xx、网络异常、协议不符都经 clientLog 记录", async () => {
    const { api } = await import("../../src/components/shared/ui");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "INTERNAL_ERROR", message: "x" } },
          { status: 500 },
        ),
      ),
    );
    await expect(api("/api/posts?q=secret")).rejects.toMatchObject({
      status: 500,
    });
    expect(error.mock.calls[0][1]).toMatchObject({
      event: "api.request_failed",
      path: "/api/posts",
      status: 500,
      code: "INTERNAL_ERROR",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(api("/api/posts")).rejects.toThrow("offline");
    expect(warn.mock.calls.at(-1)?.[1]).toMatchObject({
      event: "api.network_failed",
    });
    expect(
      JSON.stringify([...warn.mock.calls, ...error.mock.calls]),
    ).not.toContain("secret");
    vi.unstubAllGlobals();
  });
});
