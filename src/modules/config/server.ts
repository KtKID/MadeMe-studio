/**
 * 服务端读取 A 级配置：每个请求从 D1 settings.document_json.limits 读一次，
 * 经宽松 schema 夹紧到硬上限，挂在本请求的 locals 上。
 *
 * - 不做跨请求缓存：设置页保存后，下一个请求立即生效（Workers isolate 会复用模块状态，
 *   模块级缓存会让不同 isolate 看到不同的值）。
 * - 以 locals 为键做请求内记忆：`cloudflare:workers` 的 env 是跨请求共享的模块对象，不能当键。
 * - 读取失败（D1 异常、JSON 损坏）时记录 error 日志并使用默认值，不静默。
 */
import { logCaught } from "../log/server";
import { DEFAULT_CONFIG } from "./defaults";
import { resolveConfig, type RuntimeConfig } from "./schema";

type ConfigDB = {
  prepare(sql: string): {
    first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  };
};

export async function loadConfig(env: { DB?: unknown }): Promise<RuntimeConfig> {
  const db = env.DB as ConfigDB | undefined;
  if (!db) return structuredClone(DEFAULT_CONFIG);
  try {
    const row = await db
      .prepare(
        "SELECT json_extract(document_json,'$.limits') AS limits FROM settings WHERE id=1",
      )
      .first<{ limits: string | null }>();
    return resolveConfig(row?.limits ? JSON.parse(row.limits) : {});
  } catch (error) {
    logCaught("config.load_failed", error);
    return structuredClone(DEFAULT_CONFIG);
  }
}

const memo = new WeakMap<object, Promise<RuntimeConfig>>();
/** 请求内记忆：同一请求多处调用只读一次 D1。 */
export function requestConfig(context: {
  locals: unknown;
}): Promise<RuntimeConfig> {
  const locals = context.locals as { env?: { DB?: unknown } } | undefined;
  if (!locals || typeof locals !== "object") return loadConfig({});
  let pending = memo.get(locals);
  if (!pending) {
    pending = loadConfig(locals.env ?? {});
    memo.set(locals, pending);
  }
  return pending;
}
/** 已经读到最新配置（例如刚保存设置）时，更新本请求的记忆值。 */
export function attachConfig(context: { locals: unknown }, config: RuntimeConfig) {
  if (context.locals && typeof context.locals === "object")
    memo.set(context.locals, Promise.resolve(config));
}
