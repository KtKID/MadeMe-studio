export interface D1Result {
  success: boolean;
  results?: unknown[];
  meta: { changes?: number };
  error?: string;
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}
export interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
}
export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: unknown,
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}
export interface RuntimeEnv {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  OWNER_ID?: string;
  OWNER_EMAIL?: string;
  AUTH_MODE?: string;
  ENVIRONMENT?: string;
  ALLOW_LOCAL_DEV_IDENTITY?: string;
  DEV_OWNER_ID?: string;
  GEMINI_API_KEY?: string;
  SILICONFLOW_IMAGE_HOSTS?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  SILICONFLOW_API_KEY?: string;
  CLOUDFLARE_AI_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  IMAGE_API_KEY?: string;
  IMAGE_MODEL?: string;
  SESSION_SECRET?: string;
}
export interface RequestContext {
  request: Request;
  locals: unknown;
}
export function getEnv(context: RequestContext): RuntimeEnv {
  const l = context.locals as {
    runtime?: { env?: RuntimeEnv };
    env?: RuntimeEnv;
  };
  return l.env ?? {};
}
