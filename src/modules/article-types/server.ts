import { ARTICLE_TYPE_REFERENCED_SQL } from "./sql";
import type { RuntimeEnv } from "../../server/runtime";
import { AppError } from "../../server/errors";
import { readSettings } from "../../server/settings";
import {
  defaultSettings,
  settingsSchema,
  type Post,
} from "../../shared/contracts";
import {
  ARTICLE_TYPE_LIMIT,
  articleTypeListSchema,
  articleTypeMutationSchema,
  articleTypeNameKey,
  type ArticleTypeMutation,
} from "./contracts";
import { ARTICLE_TYPE_CAS_ATTEMPTS } from "../config/limits";
/** 仅专用接口调用：整体数组修改采用原始 JSON CAS，不覆盖同时写入的其它配置。 */
export async function mutateArticleTypes(
  env: RuntimeEnv,
  input: ArticleTypeMutation,
) {
  if (!env.DB)
    throw new AppError(503, "STORAGE_NOT_CONFIGURED", "文章类型存储尚未配置。");
  const command = articleTypeMutationSchema.parse(input);
  // 同一次请求重试使用同一个 ID，不因 CAS 重试产生多份身份。
  const createdId =
    command.action === "create" ? crypto.randomUUID() : undefined;
  for (let attempt = 0; attempt < ARTICLE_TYPE_CAS_ATTEMPTS; attempt++) {
    const row = await env.DB.prepare(
      "SELECT document_json FROM settings WHERE id=1",
    ).first<{ document_json: string }>();
    const raw = row
      ? JSON.parse(row.document_json)
      : { ...defaultSettings, limits: {} };
    const types = settingsSchema.parse(raw).articleTypes;
    if (
      command.action !== "delete" &&
      types.some(
        (t) =>
          [t.name, ...(t.legacyNames ?? [])].some(
            (name) =>
              articleTypeNameKey(name) === articleTypeNameKey(command.name),
          ) &&
          (command.action === "create" || t.id !== command.id),
      )
    )
      throw new AppError(
        409,
        "ARTICLE_TYPE_DUPLICATE",
        "已存在同名类型，请选择已有类型。",
      );
    if (command.action !== "create" && !types.some((t) => t.id === command.id))
      throw new AppError(
        404,
        "ARTICLE_TYPE_NOT_FOUND",
        "此类型已被删除，请刷新后重试。",
      );
    if (command.action === "create" && types.length >= ARTICLE_TYPE_LIMIT)
      throw new AppError(
        422,
        "ARTICLE_TYPE_LIMIT",
        `最多可设置 ${ARTICLE_TYPE_LIMIT} 个类型。`,
      );
    const next =
      command.action === "create"
        ? [...types, { id: createdId!, name: command.name }]
        : command.action === "rename"
          ? types.map((t) =>
              t.id === command.id
                ? {
                    ...t,
                    name: command.name,
                    legacyNames: [
                      ...new Set([...(t.legacyNames ?? []), t.name]),
                    ].filter((name) => name !== command.name),
                  }
                : t,
            )
          : types.filter((t) => t.id !== command.id);
    // 历史名称有上限，超限明确拒绝，不写入后才让读取协议失败。
    if (next.some((t) => (t.legacyNames?.length ?? 0) > ARTICLE_TYPE_LIMIT))
      throw new AppError(
        422,
        "ARTICLE_TYPE_HISTORY_LIMIT",
        "此类型历史名称已达上限，无法继续更名。",
      );
    const checked = articleTypeListSchema.parse(next);
    const document = JSON.stringify({ ...raw, articleTypes: checked });
    const now = new Date().toISOString();
    const referenceValues =
      command.action === "delete"
        ? [
            command.id,
            JSON.stringify([
              types.find((t) => t.id === command.id)!.name,
              ...(types.find((t) => t.id === command.id)!.legacyNames ?? []),
            ]),
            command.id,
            JSON.stringify([
              types.find((t) => t.id === command.id)!.name,
              ...(types.find((t) => t.id === command.id)!.legacyNames ?? []),
            ]),
          ]
        : [];
    const guard =
      command.action === "delete"
        ? ` AND NOT ${ARTICLE_TYPE_REFERENCED_SQL}`
        : "";
    const result = row
      ? await env.DB.prepare(
          `UPDATE settings SET document_json=?,updated_at=? WHERE id=1 AND document_json=?${guard}`,
        )
          .bind(document, now, row.document_json, ...referenceValues)
          .run()
      : await env.DB.prepare(
          `INSERT INTO settings (id,document_json,updated_at) SELECT 1,?,? WHERE 1=1${guard} ON CONFLICT(id) DO NOTHING`,
        )
          .bind(document, now, ...referenceValues)
          .run();
    if (command.action === "delete" && result.meta?.changes !== 1) {
      const referenced = await env.DB.prepare(
        `SELECT ${ARTICLE_TYPE_REFERENCED_SQL} AS used`,
      )
        .bind(...referenceValues)
        .first<{ used: number }>();
      if (referenced?.used)
        throw new AppError(
          409,
          "ARTICLE_TYPE_IN_USE",
          "仍有文章使用此类型，请先调整文章类型后再删除。",
        );
    }
    if (result.meta?.changes === 1)
      return { types: next, ...(createdId ? { selectedId: createdId } : {}) };
  }
  throw new AppError(
    409,
    "ARTICLE_TYPES_CHANGED",
    "类型设置正在被修改，请重试。",
  );
}
/** ID 有值时以服务端类型名为准；已删除类型只允许原文章保留原记录，不接受伪造新归属。 */
export async function canonicalArticleType<
  T extends { categoryId?: string | null; category?: string },
>(env: RuntimeEnv, input: T, previous?: Post): Promise<T> {
  if (input.categoryId === undefined) {
    // 旧客户端显式改自由分类时解除旧 ID，避免新文字仍被归到原类型；普通正文 PATCH 不改变关联。
    if (
      previous?.categoryId &&
      input.category !== undefined &&
      input.category !== previous.category
    )
      return { ...input, categoryId: null };
    return input;
  }
  if (input.categoryId === null) return { ...input, category: "" };
  const type = (await readSettings(env)).articleTypes.find(
    (t) => t.id === input.categoryId,
  );
  if (type) return { ...input, category: type.name };
  if (previous?.categoryId === input.categoryId)
    return { ...input, category: previous.category };
  throw new AppError(
    422,
    "ARTICLE_TYPE_NOT_FOUND",
    "所选类型已不存在，请重新选择。",
  );
}
