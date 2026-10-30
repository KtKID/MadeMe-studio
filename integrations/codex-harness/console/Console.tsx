import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import {
  harnessAckSchema,
  harnessLoginSchema,
  harnessStatusSchema,
  harnessTaskSchema,
  harnessModelSchema,
  type HarnessTaskInput,
  type HarnessLogin,
  type HarnessStatus,
  type HarnessTask,
} from "../contracts";
import "./style.css";
import { PUBLIC_TEST_INPUTS } from "../recording/public-samples";
const safeErrors: Record<string, string> = {
  REPLAY_NOT_FOUND:
    "没有匹配的录制，请核对模型与测试类型；不会自动发起真实调用。",
  RECORDING_EXISTS: "已有录制，请使用回放，不会再次发起真实调用。",
  RECORDING_PENDING:
    "存在未确认的执行记录，已阻止再次调用模型；请先检查本地记录。",
  RECORDING_CONSENT_REQUIRED: "真实录制前需要明确确认可能产生费用。",
  RECORDING_INCOMPLETE: "录制未完成，不能回放或自动重复调用模型。",
  RECORDING_SENSITIVE:
    "检测到敏感内容，已拒绝保存录制；请检查本地任务，不要重复提交。",
  RECORDING_CORRUPT: "录制完整性校验失败，已停止回放。",
  RECORDING_TOO_LARGE: "录制超过安全大小限制，已停止保存或回放。",
  RECORDING_DIRECTORY: "录制目录不可用，请检查本地目录配置与权限。",
  RECORDING_PROTOCOL: "录制协议不匹配，已停止回放或录制。",
  REPLAY_MISS: "没有匹配的录制，请核对模型与测试类型；不会自动发起真实调用。",
  REPLAY_MISMATCH: "录制与当前模型、协议或样本不匹配；不会自动发起真实调用。",
  AUTH_REQUIRED: "尚未设置 Codex 凭据。",
  RECORD_CONSENT_REQUIRED: "真实录制需要明确确认可能计费。",
  PUBLIC_TEST_ONLY: "仅允许使用固定公开测试样本。",
  MODEL_REQUIRED: "请填写有效模型 ID。",
  TASK_RUNNING: "已有任务正在运行，请先完成或取消。",
};
class RejectedRequest extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function taskError(code: string) {
  return (
    (Object.hasOwn(safeErrors, code) ? safeErrors[code] : undefined) ||
    "任务未能完成，请检查本地运行状态；不会自动重试。"
  );
}
const activeTask = (task: HarnessTask | null) =>
  !!task && ["queued", "running"].includes(task.status);
/** 不回显上游错误、登录地址或授权码，避免把认证材料带入日志/错误提示。 */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new Error("无法连接本地服务，请检查连接后刷新状态。");
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    const code = errorBody?.error?.code;
    if (typeof code === "string" && Object.hasOwn(safeErrors, code))
      throw new RejectedRequest(code, safeErrors[code]);
    throw new Error(
      response.status === 401
        ? "本地会话已失效，请从终端重新打开控制台。"
        : "本地服务未能完成请求，请检查状态；不会自动重试。",
    );
  }
  const data = await response.json().catch(() => {
    throw new Error("本地服务响应不符合安全协议，请检查版本。");
  });
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error("本地服务响应不符合安全协议，请检查版本。");
  return parsed.data;
}
export default function HarnessConsole() {
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [login, setLogin] = useState<HarnessLogin | null>(null);
  const [task, setTask] = useState<HarnessTask | null>(null);
  const [kind, setKind] = useState<"polish-selection" | "image-generation">(
    "polish-selection",
  );
  const input = PUBLIC_TEST_INPUTS[kind];
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState("initial");
  const [error, setError] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const mounted = useRef(false),
    initial = useRef(false),
    lock = useRef(false);
  const loginRef = useRef<HarnessLogin | null>(null),
    taskRef = useRef<HarnessTask | null>(null);
  const sequence = useRef(0);
  const uncertainRequest = useRef<HarnessTaskInput | null>(null);
  const updateTask = useCallback((value: HarnessTask) => {
    taskRef.current = value;
    setTask(value);
  }, []);
  const updateLogin = useCallback((value: HarnessLogin | null) => {
    loginRef.current = value;
    setLogin(value);
  }, []);
  const refreshStatus = useCallback(async () => {
    const value = await request("/v1/status", harnessStatusSchema).catch(
      (error) => {
        if (mounted.current) setStatus(null);
        throw error;
      },
    );
    if (mounted.current) {
      setStatus(value);
      if (value.authenticated) updateLogin(null);
      else if (value.loginStatus === "failed") {
        updateLogin(null);
        setError(value.loginError || "网页登录未完成，请重试。");
      }
    }
    return value;
  }, [updateLogin]);
  useEffect(() => {
    mounted.current = true;
    if (!initial.current) {
      initial.current = true;
      // 一次性配对码仅在内存请求中使用；读取后立即移除地址栏片段。
      const params = new URLSearchParams(location.hash.slice(1));
      const code = params.get("pair");
      if (location.hash)
        history.replaceState(
          history.state,
          "",
          location.pathname + location.search,
        );
      void (async () => {
        try {
          if (code) await request("/v1/pair", harnessAckSchema, { code });
          await refreshStatus();
        } catch (e) {
          if (mounted.current) setError((e as Error).message);
        } finally {
          if (mounted.current) setBusy("");
        }
      })();
    }
    return () => {
      mounted.current = false;
    };
  }, [refreshStatus]);
  // 单次轮询完成后再安排下一次，避免慢响应堆叠；任何失败停止自动轮询。
  useEffect(() => {
    if (!login && !activeTask(task)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const snapshot = sequence.current;
      try {
        if (loginRef.current) await refreshStatus();
        const current = taskRef.current;
        if (activeTask(current)) {
          const next = await request(
            `/v1/tasks/${current!.id}`,
            harnessTaskSchema,
          );
          if (
            !stopped &&
            mounted.current &&
            snapshot === sequence.current &&
            taskRef.current?.id === next.id
          )
            updateTask(next);
        }
        if (!stopped) timer = setTimeout(tick, 1200);
      } catch (e) {
        if (!stopped && mounted.current) setError((e as Error).message);
      }
    };
    timer = setTimeout(tick, 1200);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [login?.loginId, task?.id, task?.status, refreshStatus, updateTask]);
  async function action(name: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy("");
    }
  }
  const supported =
    kind === "polish-selection"
      ? status?.capabilities.polishSelection
      : status?.capabilities.imageGeneration;
  const locked = !!busy || activeTask(task) || unconfirmed;
  async function submit(mode: "replay" | "record") {
    await action("task", async () => {
      sequence.current++;
      const body = uncertainRequest.current ?? {
        requestId: crypto.randomUUID(),
        kind,
        input,
        model,
        mode,
        recordConsent: mode === "record",
      };
      uncertainRequest.current = body;
      setUnconfirmed(true);
      try {
        const next = await request("/v1/tasks", harnessTaskSchema, body);
        uncertainRequest.current = null;
        setUnconfirmed(false);
        if (mounted.current) updateTask(next);
      } catch (error) {
        if (error instanceof RejectedRequest) {
          uncertainRequest.current = null;
          setUnconfirmed(false);
        }
        throw error;
      }
    });
  }
  return (
    <main className="harness-console">
      <header>
        <p className="eyebrow">本地单用户 · Codex Harness</p>
        <h1>写作与图片工作台</h1>
        <p>
          仅限本机受保护控制台。Codex 凭据与博客账号独立，云端网站不接收密钥。
        </p>
      </header>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <section aria-labelledby="connection-title">
        <div className="section-heading">
          <h2 id="connection-title">连接与登录</h2>
          <button
            className="secondary"
            disabled={!!busy}
            onClick={() =>
              void action("refresh", async () => {
                await refreshStatus();
                if (taskRef.current)
                  updateTask(
                    await request(
                      `/v1/tasks/${taskRef.current.id}`,
                      harnessTaskSchema,
                    ),
                  );
              })
            }
          >
            刷新状态
          </button>
        </div>
        <p role="status">
          {busy === "initial" || busy === "refresh"
            ? "正在检查本地连接…"
            : !status
              ? "本地服务未连接"
              : !status.connected
                ? "Codex 服务未连接"
                : status.authMode === "apiKey"
                  ? "凭据已设置，尚未验证真实调用"
                  : status.authenticated
                    ? "Codex 已登录"
                    : "Codex 尚未登录"}
        </p>
        <p className="hint">
          仅限在运行此服务的同一台电脑打开浏览器。支持能力不代表当前账户或模型已验证可用。
        </p>
        <div className="credential-form">
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={locked || !!login || !status}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="hint">
            只发送给已配对的本地
            runner；提交后立即清空，不保存在浏览器。设置凭据不代表已验证有效。
          </p>
          <div className="actions">
            <button
              className="secondary"
              disabled={locked || !!login || !status || !apiKey.trim()}
              onClick={() => {
                const value = apiKey;
                setApiKey("");
                void action("api-key", async () => {
                  await request("/v1/auth/api-key", harnessAckSchema, {
                    apiKey: value,
                  });
                  await refreshStatus();
                });
              }}
            >
              设置 API Key
            </button>
          </div>
        </div>
        {status?.authenticated && (
          <button
            className="secondary"
            disabled={!!busy || activeTask(task) || unconfirmed}
            onClick={() =>
              void action("logout", async () => {
                await request("/v1/logout", harnessAckSchema, {});
                updateLogin(null);
                await refreshStatus();
              })
            }
          >
            退出 Codex
          </button>
        )}
        {status && !status.authenticated && !login && (
          <button
            disabled={
              !!busy ||
              activeTask(task) ||
              unconfirmed ||
              !status.browserLoginAvailable
            }
            onClick={() =>
              void action("login", async () => {
                const value = await request(
                  "/v1/login",
                  harnessLoginSchema,
                  {},
                );
                if (mounted.current) updateLogin(value);
              })
            }
          >
            {busy === "login" ? "正在准备登录…" : "在浏览器登录 Codex"}
          </button>
        )}
        {status && !status.browserLoginAvailable && (
          <p className="hint">
            此运行模式不提供网页登录。你可明确选择 API Key
            模式；不会自动切换认证方式。
          </p>
        )}
        {login && (
          <div className="login-pending">
            <p>等待你在官方页面完成登录；此处不会代替你登录。</p>
            <div className="actions">
              <a
                className="button"
                href={login.authUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开官方登录页
              </a>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  void action("cancel-login", async () => {
                    await request("/v1/login/cancel", harnessAckSchema, {
                      loginId: login.loginId,
                    });
                    updateLogin(null);
                  })
                }
              >
                取消登录
              </button>
            </div>
          </div>
        )}
      </section>
      {unconfirmed && !busy && (
        <p className="notice">
          提交结果尚未确认。重试沿用原请求编号，避免重复创建；若服务端尚未收到，将首次提交此任务。
        </p>
      )}
      <section aria-labelledby="task-title">
        <h2 id="task-title">白名单任务</h2>
        <div className="task-options" role="group" aria-label="任务类型">
          <button
            className="secondary"
            aria-pressed={kind === "polish-selection"}
            disabled={!!busy || activeTask(task) || unconfirmed}
            onClick={() => setKind("polish-selection")}
          >
            润色选区
          </button>
          <button
            className="secondary"
            aria-pressed={kind === "image-generation"}
            disabled={!!busy || activeTask(task) || unconfirmed}
            onClick={() => setKind("image-generation")}
          >
            生成图片
          </button>
        </div>
        <label htmlFor="model-id">模型 ID</label>
        <input
          id="model-id"
          value={model}
          disabled={locked}
          autoComplete="off"
          placeholder="明确填写要测试的模型 ID"
          onChange={(e) => setModel(e.target.value)}
        />
        <label htmlFor="task-input">处理内容</label>
        <textarea
          id="task-input"
          rows={4}
          value={input}
          readOnly
          disabled={locked}
        />
        <p className="hint">
          仅录制固定公开测试样本，不接收私文。回放匹配模型、协议和样本，不会调用真实模型。
        </p>
        <p className="hint">
          真实录制可能计费，一个任务可能发起多次模型请求。不会自动重试，不开放任意命令或自动批准。
        </p>
        <div className="actions">
          {activeTask(task) && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void action("cancel-task", async () => {
                  sequence.current++;
                  updateTask(
                    await request(
                      `/v1/tasks/${task!.id}/cancel`,
                      harnessTaskSchema,
                      {},
                    ),
                  );
                })
              }
            >
              取消任务
            </button>
          )}
          {unconfirmed ? (
            <button
              disabled={!!busy || !status}
              onClick={() => void submit(uncertainRequest.current!.mode)}
            >
              重试原请求
            </button>
          ) : (
            <>
              <button
                className="secondary"
                disabled={
                  locked ||
                  !status?.authenticated ||
                  !supported ||
                  !harnessModelSchema.safeParse(model).success
                }
                onClick={() => void submit("record")}
              >
                真实运行并录制（可能计费）
              </button>
              <button
                disabled={
                  locked ||
                  !status ||
                  !harnessModelSchema.safeParse(model).success
                }
                onClick={() => void submit("replay")}
              >
                回放已录制测试
              </button>
            </>
          )}
        </div>
      </section>
      {task && (
        <section aria-labelledby="result-title">
          <h2 id="result-title">任务结果</h2>
          <p role="status">
            {
              {
                queued: "任务等待中",
                running: "任务处理中",
                completed: "任务已完成",
                failed: "任务失败",
                cancelled: "任务已取消",
              }[task.status]
            }
          </p>
          {task.error && (
            <p className="notice error">{taskError(task.error.code)}</p>
          )}
          {task.status === "completed" && task.mode === "record" && (
            <p className="notice">
              录制已完成，现在可回放匹配模型、协议与公开样本的结果。
            </p>
          )}
          {task.events.length > 0 && (
            <div aria-label="任务事件" className="event-list">
              {task.events.map((event, index) => (
                <p key={event.seq}>
                  <span className="hint">
                    #{event.seq} · {event.elapsedMs} ms{" "}
                  </span>
                  {event.type === "text-delta"
                    ? event.text
                    : `状态：${event.status}`}
                </p>
              ))}
            </div>
          )}
          {task.status === "completed" && task.result?.text && (
            <pre className="result-text">{task.result.text}</pre>
          )}
          {task.status === "completed" && task.result?.artifactId && (
            <>
              <img
                className="result-image"
                src={`/v1/artifacts/${task.result.artifactId}`}
                alt="Codex 生成图片"
              />
              <a
                className="button secondary"
                href={`/v1/artifacts/${task.result.artifactId}`}
                download
              >
                下载图片
              </a>
            </>
          )}
        </section>
      )}
    </main>
  );
}
