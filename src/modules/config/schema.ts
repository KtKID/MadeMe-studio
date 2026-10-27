/**
 * A 级配置的 Zod 定义。两套 schema：
 * - runtimeConfigSchema（宽松读取）：D1 里的值缺失、类型错、越界时，逐字段回退默认或夹紧到范围内，
 *   保证坏数据不会让站点挂掉；
 * - runtimeConfigPatchSchema（严格写入）：设置页提交时，越界/类型错直接拒绝并给出中文提示，
 *   绝不静默替换；null 表示“恢复默认”（JSON merge patch 删除该字段）。
 */
import { z } from "zod";
import { embedProviders } from "../embed/registry.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import {
  HARD_MAX_AI_TIMEOUT_SECONDS,
  HARD_MAX_MARKDOWN_IMPORT_KB,
  HARD_MAX_SESSION_HOURS,
  HARD_MAX_TOKEN_DAYS,
  HARD_MAX_UNLOCK_MINUTES,
  HARD_MAX_UPLOAD_MB,
  MEDIA_MIME_LIST,
} from "./limits.ts";
import { FIELD_META, GROUP_META } from "./meta.ts";
const GROUP_LABELS = Object.fromEntries(
  Object.entries(GROUP_META).map(([k, v]) => [k, v.label]),
) as Record<string, string>;

export type ConfigGroup = "upload" | "media" | "ai" | "security" | "reading";
type Range = { min: number; max: number; step?: number };

/** 每个数值项的可调范围；max 即硬上限（读取时也会夹紧到这里）。 */
export const NUMBER_RANGES = {
  upload: {
    imageMaxMB: { min: 1, max: HARD_MAX_UPLOAD_MB },
    videoMaxMB: { min: 1, max: HARD_MAX_UPLOAD_MB },
    audioMaxMB: { min: 1, max: HARD_MAX_UPLOAD_MB },
    documentMaxMB: { min: 1, max: HARD_MAX_UPLOAD_MB },
    markdownImportMaxKB: { min: 64, max: HARD_MAX_MARKDOWN_IMPORT_KB },
  },
  media: {
    listLimit: { min: 20, max: 500 },
    cropOutputWidth: { min: 400, max: 4096 },
    cropJpegQuality: { min: 50, max: 100 },
    revisionsLimit: { min: 10, max: 500 },
  },
  ai: {
    textPerMinute: { min: 1, max: 120 },
    imagesPer5Minutes: { min: 1, max: 60 },
    requestTimeoutSeconds: { min: 10, max: HARD_MAX_AI_TIMEOUT_SECONDS },
  },
  security: {
    sessionHours: { min: 1, max: HARD_MAX_SESSION_HOURS },
    unlockMinutes: { min: 5, max: HARD_MAX_UNLOCK_MINUTES },
    tokenDefaultDays: { min: 1, max: HARD_MAX_TOKEN_DAYS },
    tokenMaxDays: { min: 1, max: HARD_MAX_TOKEN_DAYS },
  },
  reading: {
    xFallbackSeconds: { min: 3, max: 60 },
    xInitialHeight: { min: 120, max: 1200 },
    cardTags: { min: 0, max: 10 },
    rssItems: { min: 1, max: 1000 },
  },
} as const satisfies Record<ConfigGroup, Record<string, Range>>;

/** 多选项的可选值：只能从代码白名单里关闭，不能新增。 */
export const EMBED_PROVIDER_IDS = embedProviders.map((p) => p.id);
export const LIST_OPTIONS = {
  upload: { disabledTypes: MEDIA_MIME_LIST as readonly string[] },
  reading: { disabledEmbeds: EMBED_PROVIDER_IDS as readonly string[] },
} as const;

export type UploadConfig = {
  imageMaxMB: number;
  videoMaxMB: number;
  audioMaxMB: number;
  documentMaxMB: number;
  disabledTypes: string[];
  markdownImportMaxKB: number;
};
export type MediaConfig = {
  listLimit: number;
  cropOutputWidth: number;
  cropJpegQuality: number;
  revisionsLimit: number;
};
export type AIConfig = {
  textPerMinute: number;
  imagesPer5Minutes: number;
  requestTimeoutSeconds: number;
};
export type SecurityConfig = {
  sessionHours: number;
  unlockMinutes: number;
  tokenDefaultDays: number;
  tokenMaxDays: number;
};
export type ReadingConfig = {
  disabledEmbeds: string[];
  xFallbackSeconds: number;
  xInitialHeight: number;
  cardTags: number;
  rssItems: number;
};
export type RuntimeConfig = {
  upload: UploadConfig;
  media: MediaConfig;
  ai: AIConfig;
  security: SecurityConfig;
  reading: ReadingConfig;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// ---------- 宽松读取 ----------
function lenientInt(range: Range, fallback: number) {
  return z
    .unknown()
    .transform((v) =>
      typeof v === "number" && Number.isFinite(v)
        ? clamp(Math.round(v), range.min, range.max)
        : fallback,
    );
}
function lenientList(options: readonly string[], fallback: string[]) {
  const known = new Set(options);
  return z
    .unknown()
    .transform((v) =>
      Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === "string" && known.has(x)))]
        : [...fallback],
    );
}
function lenientGroup<G extends ConfigGroup>(group: G) {
  const defaults = DEFAULT_CONFIG[group] as Record<string, unknown>;
  const ranges = NUMBER_RANGES[group] as Record<string, Range>;
  const lists = (LIST_OPTIONS as Record<string, Record<string, readonly string[]>>)[group] ?? {};
  const shape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(defaults)) {
    shape[key] = lists[key]
      ? lenientList(lists[key], defaults[key] as string[])
      : lenientInt(ranges[key], defaults[key] as number);
  }
  // 逐字段解析（不用 z.object：Zod 4 会把 transform 字段当作必填，缺字段时报错而不是回退默认值）。
  return z.unknown().transform((v) => {
    const source = (
      v && typeof v === "object" && !Array.isArray(v) ? v : {}
    ) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape))
      result[key] = field.parse(source[key]);
    return result;
  }) as unknown as z.ZodType<RuntimeConfig[G]>;
}
const lenientGroups = {
  upload: lenientGroup("upload"),
  media: lenientGroup("media"),
  ai: lenientGroup("ai"),
  security: lenientGroup("security"),
  reading: lenientGroup("reading"),
};
/** 读取 D1 时使用：永不抛错，结果一定在范围内。 */
export const runtimeConfigSchema: z.ZodType<RuntimeConfig, unknown> = z
  .unknown()
  .transform((raw) => {
    const v = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const config: RuntimeConfig = {
      upload: lenientGroups.upload.parse(v.upload),
      media: lenientGroups.media.parse(v.media),
      ai: lenientGroups.ai.parse(v.ai),
      security: lenientGroups.security.parse(v.security),
      reading: lenientGroups.reading.parse(v.reading),
    };
    // 跨字段约束：默认有效期不能超过最长有效期。
    config.security.tokenDefaultDays = Math.min(
      config.security.tokenDefaultDays,
      config.security.tokenMaxDays,
    );
    return config;
  });
export function resolveConfig(raw: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(raw);
}

// ---------- 严格写入 ----------
function label(group: ConfigGroup, key: string) {
  return (FIELD_META[group] as Record<string, { label: string; unit: string }>)[key];
}
function strictInt(group: ConfigGroup, key: string, range: Range) {
  const { label: name, unit } = label(group, key);
  const u = unit ? ` ${unit}` : "";
  return z
    .number({ error: `${name}：请输入数字` })
    .int({ error: `${name}：请输入整数` })
    .min(range.min, { error: `${name}：不能小于 ${range.min}${u}` })
    .max(range.max, { error: `${name}：不能大于 ${range.max}${u}（上限）` })
    .nullable()
    .optional();
}
function strictList(group: ConfigGroup, key: string, options: readonly string[]) {
  const { label: name } = label(group, key);
  return z
    .array(
      z.string().refine((v) => options.includes(v), {
        error: `${name}：包含不认识的选项`,
      }),
      { error: `${name}：格式不正确` },
    )
    .max(options.length)
    .nullable()
    .optional();
}
function strictGroup(group: ConfigGroup) {
  const defaults = DEFAULT_CONFIG[group] as Record<string, unknown>;
  const ranges = NUMBER_RANGES[group] as Record<string, Range>;
  const lists = (LIST_OPTIONS as Record<string, Record<string, readonly string[]>>)[group] ?? {};
  const shape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(defaults))
    shape[key] = lists[key]
      ? strictList(group, key, lists[key])
      : strictInt(group, key, ranges[key]);
  return z
    .strictObject(shape, { error: `${GROUP_LABELS[group]}：包含未知的配置项` })
    .nullable()
    .optional();
}
type Nullable<T> = { [K in keyof T]?: T[K] | null };
export type RuntimeConfigPatch = {
  [G in keyof RuntimeConfig]?: Nullable<RuntimeConfig[G]> | null;
};
/** 设置页 PATCH /api/settings 的 limits 字段：深度可选，越界直接报中文错误。 */
export const runtimeConfigPatchSchema = z
  .strictObject(
    {
    upload: strictGroup("upload"),
    media: strictGroup("media"),
    ai: strictGroup("ai"),
    security: strictGroup("security"),
    reading: strictGroup("reading"),
    },
    { error: "包含未知的配置分组" },
  )
  .nullable() as unknown as z.ZodType<RuntimeConfigPatch | null>;

/** 合并后的跨字段检查（服务端写入前、设置页保存前共用）；返回中文问题列表。 */
export function configCrossProblems(config: RuntimeConfig): string[] {
  const problems: string[] = [];
  if (config.security.tokenDefaultDays > config.security.tokenMaxDays)
    problems.push(
      `${FIELD_META.security.tokenDefaultDays.label}（${config.security.tokenDefaultDays} 天）不能超过${FIELD_META.security.tokenMaxDays.label}（${config.security.tokenMaxDays} 天）`,
    );
  return problems;
}

/**
 * 按 JSON merge patch（RFC 7396）语义把补丁合到已解析配置上，用于写入前预检。
 * 不做夹紧：补丁已经过严格校验，跨字段问题要原样暴露给 configCrossProblems。
 */
export function applyConfigPatch(
  base: RuntimeConfig,
  patch: RuntimeConfigPatch | null | undefined,
): RuntimeConfig {
  if (patch === null) return structuredClone(DEFAULT_CONFIG);
  const next = structuredClone(base) as Record<string, Record<string, unknown>>;
  for (const [group, values] of Object.entries(patch ?? {})) {
    const g = group as ConfigGroup;
    if (values === null) {
      next[g] = structuredClone(DEFAULT_CONFIG[g]) as Record<string, unknown>;
      continue;
    }
    for (const [key, value] of Object.entries(values ?? {}))
      if (value !== undefined)
        next[g][key] =
          value === null
            ? structuredClone((DEFAULT_CONFIG[g] as Record<string, unknown>)[key])
            : value;
  }
  return next as unknown as RuntimeConfig;
}
