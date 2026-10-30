import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { harnessLoginCancelSchema, harnessTaskInputSchema } from "./contracts";
import { HarnessError, safeError } from "./errors";
import type { HarnessRunner } from "./runner";
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function jsonBody(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HarnessError("JSON_REQUIRED", "请使用 JSON 请求。", 415);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const raw of request) {
    const chunk = Buffer.from(raw);
    length += chunk.length;
    if (length > 100_000)
      throw new HarnessError("BODY_TOO_LARGE", "请求内容过长。", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HarnessError("INVALID_JSON", "JSON 格式无效。");
  }
}
/** 仅本机 HTTP；配对凭证与会话只存内存。构建函数不监听端口、不启动 Codex 或认证。 */
export function createHarnessHTTP(
  runner: HarnessRunner,
  options: {
    pairCode?: string;
    pairExpiresAt?: number;
    bearerToken?: string;
    consoleDirectory?: string;
    audit?: (event: {
      event: string;
      requestId: string;
      operation: string;
      status: number;
    }) => void;
  },
) {
  if (!options.pairCode && !options.bearerToken)
    throw new HarnessError(
      "AUTH_REQUIRED",
      "必须提供临时配对配置或外部管理的访问凭证。",
    );
  if (options.bearerToken && options.bearerToken.length < 32)
    throw new HarnessError("INVALID_AUTH_CONFIG", "访问凭证长度不足。");
  let pairCode = options.pairCode;
  let pairAttempts = 0;
  let session = "";
  let sessionExpiresAt = 0;
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    let operation = "unknown";
    response.once("finish", () => {
      try {
        options.audit?.({
          event: "harness.http",
          requestId,
          operation,
          status: response.statusCode,
        });
      } catch {
        /* 审计不可改变请求结果。 */
      }
    });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(value));
    };
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new HarnessError("HOST_INVALID", "本地服务地址无效。", 403);
      const host = `127.0.0.1:${address.port}`;
      const origin = `http://${host}`;
      if (
        request.headers.host !== host ||
        request.socket.remoteAddress !== "127.0.0.1" ||
        request.socket.localAddress !== "127.0.0.1"
      )
        throw new HarnessError(
          "HOST_INVALID",
          "仅接受明确的本机地址访问。",
          403,
        );
      if (request.headers.origin && request.headers.origin !== origin)
        throw new HarnessError("ORIGIN_INVALID", "拒绝跨站请求。", 403);
      const path = new URL(request.url ?? "/", origin).pathname;
      const method = request.method ?? "GET";
      operation =
        (
          {
            "/v1/pair": "pair",
            "/v1/status": "status",
            "/v1/login": "login",
            "/v1/login/cancel": "login.cancel",
            "/v1/logout": "logout",
            "/v1/tasks": "task.create",
            "/console": "console",
          } as Record<string, string>
        )[path] ??
        (/^\/v1\/tasks\/[a-f0-9-]{36}\/cancel$/.test(path)
          ? "task.cancel"
          : /^\/v1\/tasks\/[a-f0-9-]{36}$/.test(path)
            ? "task.read"
            : /^\/v1\/artifacts\/[a-f0-9-]{36}$/.test(path)
              ? "artifact.read"
              : "unknown");
      const staticFiles: Record<string, { file: string; mime: string }> = {
        "/console": { file: "index.html", mime: "text/html; charset=utf-8" },
        "/console/console.js": {
          file: "console.js",
          mime: "text/javascript; charset=utf-8",
        },
        "/console/console.css": {
          file: "console.css",
          mime: "text/css; charset=utf-8",
        },
      };
      if (method === "GET" && staticFiles[path] && options.consoleDirectory) {
        const entry = staticFiles[path];
        const bytes = await readFile(
          join(options.consoleDirectory, entry.file),
        );
        response.writeHead(200, { "Content-Type": entry.mime });
        response.end(bytes);
        return;
      }
      if (path === "/v1/pair" && method === "POST") {
        if (request.headers.origin !== origin)
          throw new HarnessError(
            "ORIGIN_INVALID",
            "配对必须由同机页面发起。",
            403,
          );
        const body = z
          .object({ code: z.string().max(200) })
          .strict()
          .parse(await jsonBody(request));
        pairAttempts++;
        if (
          pairAttempts > 10 ||
          !pairCode ||
          Date.now() > (options.pairExpiresAt ?? 0) ||
          !equal(body.code, pairCode)
        )
          throw new HarnessError(
            "PAIR_REJECTED",
            "配对链接无效、已使用或已过期，请在本机重新启动。",
            401,
          );
        pairCode = undefined;
        session = randomBytes(32).toString("base64url");
        sessionExpiresAt = Date.now() + 30 * 60_000;
        response.setHeader(
          "Set-Cookie",
          `harness_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
        );
        send(200, { ok: true });
        return;
      }
      const bearer = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice(7)
        : "";
      const bearerValid =
        !!options.bearerToken && !!bearer && equal(bearer, options.bearerToken);
      const cookie =
        request.headers.cookie
          ?.split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("harness_session="))
          ?.slice("harness_session=".length) ?? "";
      const sessionValid =
        !!session &&
        Date.now() < sessionExpiresAt &&
        !!cookie &&
        equal(cookie, session);
      if (!bearerValid && !sessionValid)
        throw new HarnessError(
          "AUTH_REQUIRED",
          "请使用本机终端提供的一次性链接配对。",
          401,
        );
      if (
        method !== "GET" &&
        method !== "HEAD" &&
        !bearerValid &&
        request.headers.origin !== origin
      )
        throw new HarnessError(
          "ORIGIN_INVALID",
          "修改请求必须来自同机页面。",
          403,
        );
      if (path === "/v1/status" && method === "GET") {
        send(200, await runner.status());
        return;
      }
      if (path === "/v1/login" && method === "POST") {
        z.object({})
          .strict()
          .parse(await jsonBody(request));
        send(200, await runner.login());
        return;
      }
      if (path === "/v1/logout" && method === "POST") {
        z.object({})
          .strict()
          .parse(await jsonBody(request));
        send(200, await runner.logout());
        return;
      }
      if (path === "/v1/login/cancel" && method === "POST") {
        send(
          200,
          await runner.cancelLogin(
            harnessLoginCancelSchema.parse(await jsonBody(request)).loginId,
          ),
        );
        return;
      }
      if (path === "/v1/tasks" && method === "POST") {
        send(
          202,
          await runner.create(
            harnessTaskInputSchema.parse(await jsonBody(request)),
          ),
        );
        return;
      }
      const task = /^\/v1\/tasks\/([a-f0-9-]{36})(\/cancel)?$/.exec(path);
      if (task && method === "GET" && !task[2]) {
        send(200, runner.get(task[1]));
        return;
      }
      if (task && method === "POST" && task[2]) {
        z.object({})
          .strict()
          .parse(await jsonBody(request));
        send(200, await runner.cancel(task[1]));
        return;
      }
      const artifact = /^\/v1\/artifacts\/([a-f0-9-]{36})$/.exec(path);
      if (artifact && method === "GET") {
        const result = runner.artifact(artifact[1]);
        response.writeHead(200, {
          "Content-Type": result.mime,
          "Content-Disposition": "inline",
        });
        response.end(result.bytes);
        return;
      }
      throw new HarnessError("NOT_FOUND", "接口不存在。", 404);
    } catch (error) {
      const safe =
        error instanceof z.ZodError
          ? new HarnessError("INVALID_INPUT", "请求字段不符合协议。", 422)
          : safeError(error);
      if (!response.headersSent)
        send(safe.status, {
          error: { code: safe.code, message: safe.message },
        });
      else response.end();
    }
  });
  return server;
}
