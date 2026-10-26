import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  check,
} from "drizzle-orm/sqlite-core";
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    publishedSlug: text("published_slug").unique(),
    documentJson: text("document_json").notNull(),
    publishedJson: text("published_json"),
    passwordHash: text("password_hash"),
    publishedPasswordHash: text("published_password_hash"),
    version: integer("version").notNull().default(1),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    mutationId: text("mutation_id").notNull(),
  },
  (t) => [index("posts_updated").on(t.updatedAt)],
);
export const revisions = sqliteTable(
  "revisions",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    version: integer("version").notNull(),
    documentJson: text("document_json").notNull(),
    createdAt: text("created_at").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.version] })],
);
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    documentJson: text("document_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);
export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    postId: text("post_id").references(() => posts.id),
    source: text("source").notNull().default("upload"),
    prompt: text("prompt"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("media_created").on(t.createdAt)],
);
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopesJson: text("scopes_json").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
});

// 限流计数属于持久化状态，避免运行实例切换后失效。
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});
