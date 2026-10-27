import { describe, expect, it } from "vitest";
import { SQLiteD1 } from "./support";
import {
  googleStartRequestSchema,
  authSessionResponseSchema,
} from "../../src/shared/auth";

describe("Google 追加迁移与协议", () => {
  it("旧表仍保留，追加flow表支持原子单次消费", async () => {
    const db = new SQLiteD1();
    try {
      expect(
        db.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='author_sessions'",
          )
          .get(),
      ).toBeTruthy();
      await db
        .prepare(
          "INSERT INTO google_auth_flows (state_hash,browser_hash,verifier,nonce,return_to,config_version,expires_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          "hashed-state",
          "hashed-browser",
          "fixture-verifier",
          "fixture-nonce",
          "/studio",
          "fixture-config",
          100,
        )
        .run();
      const consume = () =>
        db
          .prepare(
            "DELETE FROM google_auth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier",
          )
          .bind("hashed-state", "hashed-browser", 0)
          .first();
      const rows = await Promise.all([consume(), consume()]);
      expect(rows.filter(Boolean)).toHaveLength(1);
      expect(
        db.sqlite
          .prepare("PRAGMA table_info(google_author_sessions)")
          .all()
          .map((r) => r.name),
      ).toEqual([
        "token_hash",
        "config_version",
        "created_at",
        "expires_at",
        "revoked_at",
        "display_name",
      ]);
    } finally {
      db.close();
    }
  });
  it("协议接受Google模式并清洗returnTo，拒绝客户端指定callback", () => {
    expect(
      authSessionResponseSchema.parse({
        mode: "google",
        configured: true,
        authenticated: false,
      }).mode,
    ).toBe("google");
    expect(
      googleStartRequestSchema.parse({ returnTo: "https://evil.test" })
        .returnTo,
    ).toBe("/studio");
    expect(
      googleStartRequestSchema.parse({ returnTo: "/studio/settings" }).returnTo,
    ).toBe("/studio/settings");
    expect(
      googleStartRequestSchema.safeParse({ callback: "https://evil.test" })
        .success,
    ).toBe(false);
  });
});
