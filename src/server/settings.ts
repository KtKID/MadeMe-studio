import {
  defaultSettings,
  settingsSchema,
  patchSettingsSchema,
  type Settings,
} from "../shared/contracts";
import type { RuntimeEnv } from "./runtime";
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
export async function writeSettings(env: RuntimeEnv, patch: Partial<Settings>) {
  const validated = patchSettingsSchema.parse(patch);
  if (validated.providers) {
    validated.providers = validated.providers.map((provider) => ({
      ...provider,
      configured: false,
      textConfigured: undefined,
      imageConfigured: undefined,
    }));
  }
  // 在数据库单条语句内合并已校验的 patch，避免并发请求读旧值后覆盖其他字段。
  // JSON Merge Patch 的 null 会删除键；读取协议为 accent 缺省补 null，仍表示恢复皮肤默认。
  const patchJson = JSON.stringify(validated);
  await env
    .DB!.prepare(
      "INSERT INTO settings (id,document_json,updated_at) VALUES (1,json_patch(?,?),?) ON CONFLICT(id) DO UPDATE SET document_json=json_patch(settings.document_json,?),updated_at=excluded.updated_at",
    )
    .bind(
      JSON.stringify(defaultSettings),
      patchJson,
      new Date().toISOString(),
      patchJson,
    )
    .run();
  return redactSettings(await readSettings(env), true, env);
}
