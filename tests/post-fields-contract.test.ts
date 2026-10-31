import { describe, expect, it } from "vitest";
import {
  LEGACY_POST_KEYS,
  postReadSchema,
  postSchema,
} from "../src/shared/contracts";
import {
  INTEGRATION_CLIENTS,
  POST_FIELD_USAGE,
} from "../integrations/shared/post-fields";

// 契约测试：服务端 Post 字段一变，CI 就要求每个集成客户端显式决定 used / ignored。
const MANIFEST = "integrations/shared/post-fields.ts";
const serverKeys = Object.keys(postSchema.shape).sort();
const readShape = postReadSchema.shape as Record<
  string,
  { safeParse(v: unknown): { success: boolean } }
>;

describe("Post 字段 × 集成客户端契约", () => {
  for (const client of INTEGRATION_CLIENTS) {
    it(`${client}：每个服务端字段都已标注 used / ignored`, () => {
      const manifest = POST_FIELD_USAGE[client] as Record<string, string>;
      const missing = serverKeys.filter((k) => !(k in manifest));
      expect(
        missing,
        `服务端 Post 新增了字段 ${JSON.stringify(missing)}，${client} 尚未决定是否使用。` +
          `请在 ${MANIFEST} 的 POST_FIELD_USAGE["${client}"] 中逐个标注 'used' 或 'ignored'` +
          `（used 需要客户端代码真正读取并处理旧服务端不返回的情况）。`,
      ).toEqual([]);
    });

    it(`${client}：清单里没有服务端已不存在的字段，取值合法`, () => {
      const manifest = POST_FIELD_USAGE[client] as Record<string, string>;
      const stale = Object.keys(manifest).filter(
        (k) => !serverKeys.includes(k),
      );
      expect(
        stale,
        `${MANIFEST} 中 ${client} 列出了服务端 Post 已没有的字段 ${JSON.stringify(stale)}，` +
          `请删除这些条目，并确认客户端代码不再读取它们。`,
      ).toEqual([]);
      for (const [k, v] of Object.entries(manifest))
        expect(["used", "ignored"], `${client}.${k} = ${v}`).toContain(v);
    });

    it(`${client}：used 字段可被读取协议解析，非旧版字段必须可缺省`, () => {
      const manifest = POST_FIELD_USAGE[client] as Record<string, string>;
      for (const [field, use] of Object.entries(manifest)) {
        if (use !== "used") continue;
        expect(
          field in readShape,
          `${client} 使用 ${field}，但 postReadSchema 没有它`,
        ).toBe(true);
        if (!(LEGACY_POST_KEYS as readonly string[]).includes(field))
          expect(
            readShape[field].safeParse(undefined).success,
            `${client} 使用的 ${field} 不在 LEGACY_POST_KEYS（旧服务端/旧格式不返回），` +
              `读取协议里必须是可选字段，且客户端要处理缺省`,
          ).toBe(true);
      }
    });
  }

  it("LEGACY_POST_KEYS 是服务端字段的子集，且保持 0.1.0 冻结快照", () => {
    const gone = LEGACY_POST_KEYS.filter((k) => !serverKeys.includes(k));
    expect(
      gone,
      `LEGACY_POST_KEYS 中的 ${JSON.stringify(gone)} 已从服务端删除：已发出的 0.1.0 客户端仍要求这些字段，删除属于破坏性变更`,
    ).toEqual([]);
    // 冻结：新字段不得加入旧格式，否则旧版 strict 客户端会再次解析失败。
    expect([...LEGACY_POST_KEYS].sort()).toEqual(
      [
        "blocks",
        "category",
        "coverImage",
        "deletedAt",
        "excerpt",
        "id",
        "pinned",
        "publishedAt",
        "slug",
        "tags",
        "title",
        "updatedAt",
        "version",
        "visibility",
      ].sort(),
    );
  });

  it("读取协议覆盖全部服务端字段", () => {
    expect(Object.keys(postReadSchema.shape).sort()).toEqual(serverKeys);
  });
});
