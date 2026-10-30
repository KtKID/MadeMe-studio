import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { HarnessError } from "./errors";
export interface RPCClient {
  request(method: string, params?: unknown): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): this;
  close(): void;
}
/** 只传输固定 JSON-RPC，不把用户文字拼进 shell。stdout 不可信，限制单行与未完成请求。 */
export class StdioRPC extends EventEmitter implements RPCClient {
  private nextId = 0;
  private buffer = "";
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private child: ChildProcessWithoutNullStreams,
    private timeoutMs = 15_000,
  ) {
    super();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => this.consume(data));
    child.stdin.on("error", () => this.fail());
    child.stderr.on("data", () => {}); // 禁止转发可能包含认证资料的原始 stderr。
    child.on("error", () => this.fail());
    child.on("exit", () => this.fail());
  }
  private fail() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        new HarnessError(
          "PROCESS_DISCONNECTED",
          "Codex 进程已断开，请重启本地服务。",
          503,
        ),
      );
    }
    this.pending.clear();
    this.emit("disconnect");
  }
  private consume(data: string) {
    this.buffer += data;
    if (Buffer.byteLength(this.buffer) > 24_000_000) {
      this.close();
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        this.close();
        return;
      }
      if (message && typeof message.method === "string") {
        if (message.id !== undefined) {
          // 任何服务端审批/工具请求都不自动批准；未知请求也失败关闭。
          const denied = [
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
          ].includes(message.method)
            ? { id: message.id, result: { decision: "cancel" } }
            : {
                id: message.id,
                error: {
                  code: -32601,
                  message: "This harness does not grant tool approvals.",
                },
              };
          this.child.stdin.write(JSON.stringify(denied) + "\n");
          this.emit("approval", { method: message.method });
        } else
          this.emit("notification", {
            method: message.method,
            params: message.params,
          });
      } else if (typeof message?.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new HarnessError("RPC_REJECTED", "Codex 未能完成此操作。", 502),
          );
        else pending.resolve(message.result);
      }
    }
  }
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed)
      return Promise.reject(
        new HarnessError("PROCESS_DISCONNECTED", "Codex 进程已断开。", 503),
      );
    if (this.pending.size >= 32)
      return Promise.reject(
        new HarnessError("RPC_BUSY", "本地服务繁忙。", 429),
      );
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HarnessError(
            "RPC_TIMEOUT",
            "Codex 操作超时；不会自动重试。",
            504,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        }) + "\n",
      );
    });
  }
  notify(method: string, params?: unknown) {
    if (!this.closed)
      this.child.stdin.write(
        JSON.stringify({
          method,
          ...(params === undefined ? {} : { params }),
        }) + "\n",
      );
  }
  close() {
    this.fail();
    this.child.kill();
  }
}
/** 显式调用才启动；仅继承启动二进制所需 PATH，不继承个人密钥、代理或 Codex 配置。 */
export async function startAppServer(options: {
  command: string;
  codexHome: string;
  workspaceRoot: string;
  path?: string;
}) {
  if (
    !isAbsolute(options.command) ||
    !isAbsolute(options.codexHome) ||
    !isAbsolute(options.workspaceRoot)
  )
    throw new HarnessError("INVALID_HOST_CONFIG", "请配置独立的绝对路径。");
  const child = spawn(
    options.command,
    [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      "features.shell_tool=false",
      "-c",
      "mcp_servers={}",
      "-c",
      'web_search="disabled"',
      "-c",
      'forced_login_method="chatgpt"',
    ],
    {
      cwd: options.workspaceRoot,
      shell: false,
      stdio: "pipe",
      env: {
        PATH: options.path ?? "/usr/bin:/bin",
        HOME: options.codexHome,
        CODEX_HOME: options.codexHome,
      },
    },
  );
  const rpc = new StdioRPC(child);
  try {
    await rpc.request("initialize", {
      clientInfo: {
        name: "mademe_local_harness",
        title: "Local writing harness",
        version: "0.1.0",
      },
      capabilities: {
        explicitGatewayOauth: true,
        experimentalApi: false,
        requestAttestation: false,
      },
    });
    rpc.notify("initialized");
    return rpc;
  } catch (e) {
    rpc.close();
    throw e;
  }
}
