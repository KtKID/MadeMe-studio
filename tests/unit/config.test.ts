import { describe, expect, it } from "vitest";
import {
  AI_ENDPOINTS,
  AI_PROVIDER_HOSTS,
  DEFAULT_CONFIG,
  EMBED_PROVIDER_IDS,
  FIELD_META,
  GENERATED_MEDIA_POLICY,
  HARD_MAX_UPLOAD_BYTES,
  HARD_MAX_UPLOAD_MB,
  LIST_OPTIONS,
  MAX_CONTENT_DEPTH,
  MiB,
  NUMBER_RANGES,
  TEXT_LIMITS,
  applyConfigPatch,
  configCrossProblems,
  enabledMediaMimes,
  resolveConfig,
  runtimeConfigPatchSchema,
  toClientConfig,
  uploadHint,
  uploadLimitBytes,
  uploadProblem,
  type ConfigGroup,
} from "../../src/modules/config";
import {
  deploymentStatus,
  parseLogLevel,
  sessionSecretConfigured,
} from "../../src/modules/config/env";
import { embedProviders } from "../../src/modules/embed";
import { validateMedia } from "../../src/server/media/service";
import { slugify } from "../../src/server/content/validation";
import { defaultSettings, settingsSchema } from "../../src/shared/contracts";

const groups = Object.keys(DEFAULT_CONFIG) as ConfigGroup[];

describe("配置模块：默认值、范围、元数据一一对应", () => {
  it("每个默认项都有中文元数据，以及范围或可选值", () => {
    for (const group of groups)
      for (const [key, value] of Object.entries(DEFAULT_CONFIG[group])) {
        const meta = (FIELD_META[group] as Record<string, { label: string }>)[key];
        expect(meta?.label, `${group}.${key}`).toMatch(/[\u4e00-\u9fa5]/);
        if (Array.isArray(value))
          expect(
            (LIST_OPTIONS as Record<string, Record<string, unknown>>)[group]?.[key],
            `${group}.${key}`,
          ).toBeTruthy();
        else {
          const range = (NUMBER_RANGES[group] as Record<string, { min: number; max: number }>)[key];
          expect(range, `${group}.${key}`).toBeTruthy();
          expect(value).toBeGreaterThanOrEqual(range.min);
          expect(value).toBeLessThanOrEqual(range.max);
        }
      }
  });
  it("上传默认 25 MB、硬上限 50 MB", () => {
    expect(DEFAULT_CONFIG.upload.videoMaxMB).toBe(25);
    expect(HARD_MAX_UPLOAD_MB).toBe(50);
    expect(NUMBER_RANGES.upload.videoMaxMB.max).toBe(HARD_MAX_UPLOAD_MB);
    expect(HARD_MAX_UPLOAD_BYTES).toBe(50 * MiB);
  });
  it("嵌入平台可选值来自嵌入注册表", () => {
    expect(EMBED_PROVIDER_IDS).toEqual(embedProviders.map((p) => p.id));
  });
});

describe("宽松读取：坏数据回退默认、越界夹紧，永不抛错", () => {
  it("缺失、null、非对象 → 全部默认值", () => {
    for (const raw of [undefined, null, "x", 3, [], {}])
      expect(resolveConfig(raw)).toEqual(DEFAULT_CONFIG);
  });
  it("越界夹紧到范围，非整数四舍五入，类型错误回退默认", () => {
    const config = resolveConfig({
      upload: { videoMaxMB: 999, imageMaxMB: 0, audioMaxMB: "30", documentMaxMB: 10.6 },
      media: { listLimit: Number.NaN },
      security: { tokenDefaultDays: 300, tokenMaxDays: 30 },
    });
    expect(config.upload.videoMaxMB).toBe(50);
    expect(config.upload.imageMaxMB).toBe(1);
    expect(config.upload.audioMaxMB).toBe(25);
    expect(config.upload.documentMaxMB).toBe(11);
    expect(config.media.listLimit).toBe(100);
    // 跨字段：默认有效期不超过最长有效期
    expect(config.security.tokenDefaultDays).toBe(30);
  });
  it("多选项只保留认识的值并去重", () => {
    const config = resolveConfig({
      upload: { disabledTypes: ["video/quicktime", "text/html", "video/quicktime", 1] },
      reading: { disabledEmbeds: ["x", "evil"] },
    });
    expect(config.upload.disabledTypes).toEqual(["video/quicktime"]);
    expect(config.reading.disabledEmbeds).toEqual(["x"]);
  });
  it("settingsSchema 读取旧数据（没有 limits）时补默认值", () => {
    const { limits: _ignored, ...legacy } = defaultSettings;
    expect(settingsSchema.parse(legacy).limits).toEqual(DEFAULT_CONFIG);
  });
});

describe("严格写入：越界给出中文原因", () => {
  it("超过硬上限", () => {
    const result = runtimeConfigPatchSchema.safeParse({ upload: { videoMaxMB: 51 } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe(
      "视频单个文件上限：不能大于 50 MB（上限）",
    );
  });
  it("非整数、未知字段、未知选项都被拒绝", () => {
    expect(
      runtimeConfigPatchSchema.safeParse({ ai: { textPerMinute: 1.5 } }).error!.issues[0].message,
    ).toContain("请输入整数");
    expect(
      runtimeConfigPatchSchema.safeParse({ ai: { foo: 1 } }).error!.issues[0].message,
    ).toContain("未知");
    expect(
      runtimeConfigPatchSchema.safeParse({ reading: { disabledEmbeds: ["evil"] } }).error!
        .issues[0].message,
    ).toContain("不认识");
  });
  it("null 表示恢复默认；合并后检查跨字段规则", () => {
    expect(runtimeConfigPatchSchema.safeParse({ upload: { videoMaxMB: null } }).success).toBe(true);
    const base = resolveConfig({ upload: { videoMaxMB: 40 } });
    expect(applyConfigPatch(base, { upload: { videoMaxMB: null } }).upload.videoMaxMB).toBe(25);
    expect(applyConfigPatch(base, { upload: null }).upload).toEqual(DEFAULT_CONFIG.upload);
    const bad = applyConfigPatch(DEFAULT_CONFIG, { security: { tokenMaxDays: 30 } });
    expect(configCrossProblems(bad)[0]).toContain("不能超过");
  });
});

describe("前后端同一个上传检查", () => {
  const upload = resolveConfig({
    upload: { videoMaxMB: 10, imageMaxMB: 2, disabledTypes: ["audio/wav"] },
  }).upload;
  it("按类型上限", () => {
    expect(uploadLimitBytes(upload, "video")).toBe(10 * MiB);
    expect(uploadProblem({ size: 10 * MiB + 1, type: "video/mp4" }, upload)?.reason).toBe(
      "too_large",
    );
    expect(uploadProblem({ size: 10 * MiB, type: "video/mp4" }, upload)).toBeNull();
    expect(uploadProblem({ size: 3 * MiB, type: "image/png" }, upload)?.message).toContain("2 MB");
  });
  it("禁用类型与不支持类型", () => {
    expect(uploadProblem({ size: 10, type: "audio/wav" }, upload)?.code).toBe(
      "MEDIA_TYPE_DISABLED",
    );
    expect(uploadProblem({ size: 10, type: "text/html" }, upload)?.code).toBe(
      "UNSUPPORTED_MEDIA",
    );
    expect(enabledMediaMimes(upload)).not.toContain("audio/wav");
    expect(uploadHint(upload, "video")).toContain("≤ 10 MB");
  });
  it("服务端 validateMedia 与浏览器端给出同一个原因", () => {
    const problem = uploadProblem({ size: 11 * MiB, type: "video/mp4" }, upload)!;
    try {
      validateMedia(new Uint8Array(11 * MiB), "video/mp4", upload);
      expect.unreachable();
    } catch (error) {
      expect((error as { status: number }).status).toBe(problem.status);
      expect((error as Error).message).toBe(problem.message);
    }
  });
  it("AI 生成图片使用硬上限策略，不受作者禁用类型影响", () => {
    expect(GENERATED_MEDIA_POLICY.disabledTypes).toEqual([]);
    expect(uploadLimitBytes(GENERATED_MEDIA_POLICY, "image")).toBe(HARD_MAX_UPLOAD_BYTES);
  });
});

describe("下发裁剪", () => {
  it("读者只拿到阅读相关项，其余为默认值", () => {
    const config = resolveConfig({
      upload: { videoMaxMB: 40 },
      security: { sessionHours: 24 },
      reading: { cardTags: 5, disabledEmbeds: ["x"] },
    });
    const reader = toClientConfig(config, "reader");
    expect(reader.upload.videoMaxMB).toBe(25);
    expect(reader.security.sessionHours).toBe(8);
    expect(reader.reading.cardTags).toBe(5);
    expect(reader.reading.disabledEmbeds).toEqual(["x"]);
    expect(toClientConfig(config, "owner")).toEqual(config);
  });
});

describe("部署环境（B 层）", () => {
  it("只报告是否配置，不输出值", () => {
    const secret = "s".repeat(40);
    const items = deploymentStatus({
      SESSION_SECRET: secret,
      OPENAI_API_KEY: "sk-test-value",
      AUTH_MODE: "google",
    } as never);
    const json = JSON.stringify(items);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("sk-test-value");
    expect(items.find((i) => i.key === "sessionSecret")?.configured).toBe(true);
    expect(items.find((i) => i.key === "openai")?.configured).toBe(true);
    expect(items.find((i) => i.key === "gemini")?.configured).toBe(false);
  });
  it("SESSION_SECRET 至少 32 字符", () => {
    expect(sessionSecretConfigured({ SESSION_SECRET: "a".repeat(31) } as never)).toBe(false);
    expect(sessionSecretConfigured({ SESSION_SECRET: "a".repeat(32) } as never)).toBe(true);
  });
  it("LOG_LEVEL 解析：缺省 info，非法值回退 info 并标记", () => {
    expect(parseLogLevel(undefined)).toEqual({ level: "info", valid: true });
    expect(parseLogLevel("WARN")).toEqual({ level: "warn", valid: true });
    expect(parseLogLevel("verbose")).toEqual({ level: "info", valid: false });
  });
});

describe("C 层常量统一", () => {
  it("AI 出站白名单由端点表推导", () => {
    const hosts = [
      AI_ENDPOINTS.openai.chat,
      AI_ENDPOINTS.openrouter.chat,
      AI_ENDPOINTS.siliconflow.chat,
      AI_ENDPOINTS.gemini.models,
    ].map((url) => new URL(url).hostname);
    for (const host of hosts) expect(AI_PROVIDER_HOSTS).toContain(host);
  });
  it("slug 主体预留后缀，加后缀后不超过契约上限且不以连字符结尾", () => {
    const body = slugify("a ".repeat(400));
    expect(body.length).toBeLessThanOrEqual(TEXT_LIMITS.slug - 7);
    expect(body.endsWith("-")).toBe(false);
    expect(`${body}-abcdef`.length).toBeLessThanOrEqual(TEXT_LIMITS.slug);
  });
  it("正文深度上限前后端同一常量", () => {
    expect(MAX_CONTENT_DEPTH).toBe(30);
  });
});
