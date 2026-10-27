/**
 * B 级：部署级配置（wrangler 变量 / Secrets / 本地 .dev.vars）。
 * 这些值只在部署时设置，设置页只读展示“已配置 / 未配置”，永远不回显具体值。
 */
import { SESSION_SECRET_MIN_LENGTH } from "./limits";

/** 本模块只关心的环境字段（与 src/server/runtime.ts RuntimeEnv 兼容）。 */
export type DeploymentEnv = {
  DB?: unknown;
  BUCKET?: unknown;
  AUTH_MODE?: string;
  APP_ORIGIN?: string;
  OWNER_ID?: string;
  OWNER_EMAIL?: string;
  OWNER_GOOGLE_SUB?: string;
  AUTH_PASSWORD_HASH?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  SILICONFLOW_API_KEY?: string;
  SILICONFLOW_IMAGE_HOSTS?: string;
  CLOUDFLARE_AI_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  GEMINI_API_KEY?: string;
  IMAGE_API_KEY?: string;
  IMAGE_MODEL?: string;
  LOG_LEVEL?: string;
};

/** SESSION_SECRET 是否足够长（作者会话、Google 会话、文章密码 Cookie 共用此判断）。 */
export function sessionSecretConfigured(env: { SESSION_SECRET?: string }) {
  return (env.SESSION_SECRET?.length ?? 0) >= SESSION_SECRET_MIN_LENGTH;
}

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type ConfigLogLevel = (typeof LOG_LEVELS)[number];
/** 未设置 LOG_LEVEL 时的级别。 */
export const DEFAULT_LOG_LEVEL: ConfigLogLevel = "info";
export function parseLogLevel(value: string | undefined): {
  level: ConfigLogLevel;
  valid: boolean;
} {
  if (value === undefined || value === "")
    return { level: DEFAULT_LOG_LEVEL, valid: true };
  const normalized = value.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalized)
    ? { level: normalized as ConfigLogLevel, valid: true }
    : { level: DEFAULT_LOG_LEVEL, valid: false };
}

export type DeploymentItem = {
  key: string;
  label: string;
  configured: boolean;
  /** 非机密的补充说明（如当前登录方式、日志级别），绝不包含密钥、邮箱或主机值。 */
  note?: string;
};
const authModes: Record<string, string> = {
  google: "Google 登录",
  password: "邮箱密码登录",
  sites: "Sites 信任头",
};
const set = (v: string | undefined) => !!v && v.trim().length > 0;

/** 设置页“部署信息”卡片：只返回布尔值与白名单内的说明文字。 */
export function deploymentStatus(env: DeploymentEnv): DeploymentItem[] {
  const log = parseLogLevel(env.LOG_LEVEL);
  return [
    { key: "d1", label: "D1 数据库（DB）", configured: !!env.DB },
    { key: "r2", label: "R2 媒体存储（BUCKET）", configured: !!env.BUCKET },
    {
      key: "authMode",
      label: "登录方式（AUTH_MODE）",
      configured: !!authModes[env.AUTH_MODE ?? ""],
      note: authModes[env.AUTH_MODE ?? ""] ?? "未设置",
    },
    { key: "appOrigin", label: "站点地址（APP_ORIGIN）", configured: set(env.APP_ORIGIN) },
    { key: "owner", label: "作者身份（OWNER_EMAIL / OWNER_ID）", configured: set(env.OWNER_EMAIL) || set(env.OWNER_ID) },
    {
      key: "googleOAuth",
      label: "Google OAuth（GOOGLE_CLIENT_ID / SECRET）",
      configured: set(env.GOOGLE_CLIENT_ID) && set(env.GOOGLE_CLIENT_SECRET),
    },
    {
      key: "sessionSecret",
      label: `会话密钥（SESSION_SECRET ≥ ${SESSION_SECRET_MIN_LENGTH} 字符）`,
      configured: sessionSecretConfigured(env),
    },
    { key: "openai", label: "OpenAI 密钥", configured: set(env.OPENAI_API_KEY) },
    { key: "openrouter", label: "OpenRouter 密钥", configured: set(env.OPENROUTER_API_KEY) },
    { key: "siliconflow", label: "SiliconFlow 密钥", configured: set(env.SILICONFLOW_API_KEY) },
    {
      key: "cloudflareAI",
      label: "Cloudflare Workers AI（令牌 + 账户 ID）",
      configured:
        set(env.CLOUDFLARE_AI_TOKEN) &&
        /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""),
    },
    { key: "gemini", label: "Gemini 密钥", configured: set(env.GEMINI_API_KEY) },
    { key: "imageKey", label: "独立图片密钥（IMAGE_API_KEY）", configured: set(env.IMAGE_API_KEY) },
    {
      key: "logLevel",
      label: "日志级别（LOG_LEVEL）",
      configured: set(env.LOG_LEVEL) && log.valid,
      note: log.valid
        ? `${log.level}${set(env.LOG_LEVEL) ? "" : "（默认）"}`
        : `取值无效，已按 ${log.level} 处理`,
    },
  ];
}
