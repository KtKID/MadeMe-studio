import type { z } from "zod";
import {
  defaultSettings,
  settingsSchema,
  patchSettingsSchema,
  type Settings,
} from "../shared/contracts";
import type { RuntimeEnv } from "./runtime";
import { AppError } from "./errors";
import {
  applyConfigPatch,
  configCrossProblems,
  toClientConfig,
} from "../modules/config";
import { providerCapabilities } from "./ai/capabilities";
export { providerKey } from "./ai/capabilities";
export function redactSettings(
  settings: Settings,
  owner: boolean,
  env: RuntimeEnv,
): Settings {
  return {
    ...settings,
    providers: owner
      ? settings.providers.map((p) => ({
          ...p,
          configured: providerCapabilities(p, env).textConfigured,
          ...providerCapabilities(p, env),
        }))
      : [],
    prompts: owner ? settings.prompts : [],
    customCode: owner ? settings.customCode : "",
    // 读者只拿到阅读相关的配置，其余字段一律为默认值（不泄露作者的运营参数）。
    limits: toClientConfig(settings.limits, owner ? "owner" : "reader"),
  };
}
export async function readSettings(env: RuntimeEnv) {
  if (!env.DB) return structuredClone(defaultSettings);
  const row = await env.DB.prepare(
    "SELECT document_json FROM settings WHERE id=1",
  ).first<{ document_json: string }>();
  return row
    ? settingsSchema.parse(JSON.parse(row.document_json))
    : structuredClone(defaultSettings);
}
export async function writeSettings(
  env: RuntimeEnv,
  patch: Partial<Settings> | z.input<typeof patchSettingsSchema>,
) {
  const validated = patchSettingsSchema.parse(patch);
  if (validated.providers) {
    validated.providers = validated.providers.map((provider) => ({
      ...provider,
      configured: false,
      textConfigured: undefined,
      imageConfigured: undefined,
    }));
  }
  if (validated.limits !== undefined) {
    // 跨字段约束（如令牌默认有效期 ≤ 最长有效期）需要合并后才能判断；这里读一次当前值预检。
    // 预检与写入之间若有并发保存，读取时宽松 schema 仍会夹紧，不会产生越界配置。
    const merged = applyConfigPatch(
      (await readSettings(env)).limits,
      validated.limits,
    );
    const problems = configCrossProblems(merged);
    if (problems.length)
      throw new AppError(422, "INVALID_CONFIG", problems.join("；"), {
        problems,
      });
  }
  // 在数据库单条语句内合并已校验的 patch，避免并发请求读旧值后覆盖其他字段。
  // JSON Merge Patch 的 null 会删除键；读取协议为 accent 缺省补 null，仍表示恢复皮肤默认。
  const patchJson = JSON.stringify(validated);
  await env
    .DB!.prepare(
      "INSERT INTO settings (id,document_json,updated_at) VALUES (1,json_patch(?,?),?) ON CONFLICT(id) DO UPDATE SET document_json=json_patch(settings.document_json,?),updated_at=excluded.updated_at",
    )
    .bind(
      // 新建行时 limits 从空对象开始：D1 只保存作者改过的配置项，其余跟随代码默认值。
      JSON.stringify({ ...defaultSettings, limits: {} }),
      patchJson,
      new Date().toISOString(),
      patchJson,
    )
    .run();
  return redactSettings(await readSettings(env), true, env);
}
