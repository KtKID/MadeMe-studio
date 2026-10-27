/**
 * A 级默认值（唯一出处）：设置页没有改过的项，一律使用这里的值。
 *
 * D1 settings.document_json.limits 只保存作者改过的字段；“恢复默认”会删掉该字段，
 * 因此以后调整这里的默认值，会自动作用到所有没改过的站点。
 */
import type { RuntimeConfig } from "./schema.ts";

export const DEFAULT_CONFIG: RuntimeConfig = {
  upload: {
    imageMaxMB: 25,
    videoMaxMB: 25,
    audioMaxMB: 25,
    documentMaxMB: 25,
    disabledTypes: [],
    markdownImportMaxKB: 512,
  },
  media: {
    listLimit: 100,
    cropOutputWidth: 1200,
    cropJpegQuality: 92,
    revisionsLimit: 100,
  },
  ai: {
    textPerMinute: 20,
    imagesPer5Minutes: 5,
    requestTimeoutSeconds: 90,
  },
  security: {
    sessionHours: 8,
    unlockMinutes: 60,
    tokenDefaultDays: 90,
    tokenMaxDays: 365,
  },
  reading: {
    disabledEmbeds: [],
    xFallbackSeconds: 12,
    xInitialHeight: 360,
    cardTags: 3,
    rssItems: 50,
  },
};
