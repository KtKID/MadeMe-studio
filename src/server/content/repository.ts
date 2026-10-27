import {
  postSummarySchema,
  type PostSummary,
  type Post,
  type Revision,
} from "../../shared/contracts";
import type { D1Database } from "../runtime";
import { AppError } from "../errors";
import { logger } from "../../modules/log/server";
import { DEFAULT_CONFIG, QUERY_SAFETY_LIMIT } from "../../modules/config";
/** 一次性列表命中安全上限时写 warn：说明有文章没被列出（首页 / RSS / 工作台），需要分页。 */
function warnIfTruncated(count: number, query: string) {
  if (count >= QUERY_SAFETY_LIMIT)
    logger.warn("content.list_truncated", { query, limit: QUERY_SAFETY_LIMIT });
}
export type StoredPost = {
  draft: Post;
  published: Post | null;
  passwordHash: string | null;
  publishedPasswordHash: string | null;
};
export const MEDIA_REFERENCE_PAGE_SIZE = 16;
export interface PostRepository {
  list(): Promise<StoredPost[]>;
  publishedMediaCandidates(
    mediaId: string,
    afterId?: string,
  ): Promise<StoredPost[]>;
  get(id: string): Promise<StoredPost | null>;
  bySlug(slug: string): Promise<StoredPost | null>;
  create(post: StoredPost): Promise<void>;
  save(
    post: StoredPost,
    expectedVersion: number,
    reason: Revision["reason"],
  ): Promise<boolean>;
  revisions(id: string, limit?: number): Promise<Revision[]>;
  revision(id: string, version: number): Promise<Post | null>;
}
type Row = {
  document_json: string;
  published_json: string | null;
  password_hash: string | null;
  published_password_hash: string | null;
};
function decode(row: Row): StoredPost {
  return {
    draft: JSON.parse(row.document_json),
    published: row.published_json ? JSON.parse(row.published_json) : null,
    passwordHash: row.password_hash,
    publishedPasswordHash: row.published_password_hash,
  };
}
export class D1PostRepository implements PostRepository {
  constructor(private db: D1Database) {}
  /** 仅作者工作台使用；SQL 提取轻量字段，不传输完整正文或发布快照。 */
  async listSummaries(): Promise<PostSummary[]> {
    const fields = Object.keys(postSummarySchema.shape);
    const projection = fields
      .map((key) => `json_extract(document_json, '$.${key}') AS "${key}"`)
      .join(",");
    const { results } = await this.db
      .prepare(
        `SELECT ${projection} FROM posts ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(QUERY_SAFETY_LIMIT)
      .all<Record<string, unknown>>();
    warnIfTruncated(results.length, "summaries");
    return results.map((row) =>
      postSummarySchema.parse({
        ...row,
        tags: JSON.parse(row.tags as string),
        pinned: row.pinned === 1,
      }),
    );
  }
  async list() {
    const { results } = await this.db
      .prepare(
        "SELECT document_json,published_json,password_hash,published_password_hash FROM posts ORDER BY updated_at DESC LIMIT ?",
      )
      .bind(QUERY_SAFETY_LIMIT)
      .all<Row>();
    warnIfTruncated(results.length, "posts");
    return results.map(decode);
  }
  /** 媒体授权查询不复用首页截断列表；按主键分批读取精确已发布引用候选。 */
  async publishedMediaCandidates(mediaId: string, afterId = "") {
    const url = `/api/files/${mediaId}`;
    const result = await this.db
      .prepare(
        "SELECT document_json,published_json,password_hash,published_password_hash FROM posts WHERE id > ? AND deleted_at IS NULL AND published_json IS NOT NULL AND EXISTS (SELECT 1 FROM json_tree(posts.published_json) WHERE json_tree.type = 'text' AND json_tree.atom = ?) ORDER BY id ASC LIMIT ?",
      )
      .bind(afterId, url, MEDIA_REFERENCE_PAGE_SIZE)
      .all<Row>();
    return result.results.map(decode);
  }
  async get(id: string) {
    const row = await this.db
      .prepare(
        "SELECT document_json,published_json,password_hash,published_password_hash FROM posts WHERE id=?",
      )
      .bind(id)
      .first<Row>();
    return row ? decode(row) : null;
  }
  async bySlug(slug: string) {
    const row = await this.db
      .prepare(
        "SELECT document_json,published_json,password_hash,published_password_hash FROM posts WHERE slug=? OR published_slug=?",
      )
      .bind(slug, slug)
      .first<Row>();
    return row ? decode(row) : null;
  }
  async create(post: StoredPost) {
    const p = post.draft;
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO posts (id,slug,document_json,password_hash,version,created_at,updated_at,mutation_id) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            p.id,
            p.slug,
            JSON.stringify(p),
            post.passwordHash,
            p.version,
            p.updatedAt,
            p.updatedAt,
            crypto.randomUUID(),
          ),
        this.db
          .prepare(
            "INSERT INTO revisions (post_id,version,document_json,created_at,reason) VALUES (?,?,?,?,?)",
          )
          .bind(p.id, p.version, JSON.stringify(p), p.updatedAt, "save"),
      ]);
    } catch (error) {
      this.mapError(error);
    }
  }
  async save(
    post: StoredPost,
    expectedVersion: number,
    reason: Revision["reason"],
  ) {
    const p = post.draft;
    const nonce = crypto.randomUUID();
    try {
      const result = await this.db.batch([
        this.db
          .prepare(
            "UPDATE posts SET slug=?,published_slug=?,document_json=?,published_json=?,password_hash=?,published_password_hash=?,version=?,deleted_at=?,updated_at=?,mutation_id=? WHERE id=? AND version=?",
          )
          .bind(
            p.slug,
            post.published?.slug ?? null,
            JSON.stringify(p),
            post.published ? JSON.stringify(post.published) : null,
            post.passwordHash,
            post.publishedPasswordHash,
            p.version,
            p.deletedAt,
            p.updatedAt,
            nonce,
            p.id,
            expectedVersion,
          ),
        this.db
          .prepare(
            "INSERT INTO revisions (post_id,version,document_json,created_at,reason) SELECT id,version,document_json,updated_at,? FROM posts WHERE id=? AND mutation_id=?",
          )
          .bind(reason, p.id, nonce),
      ]);
      return (result[0].meta.changes ?? 0) === 1;
    } catch (error) {
      this.mapError(error);
    }
  }
  async revisions(id: string, limit = DEFAULT_CONFIG.media.revisionsLimit) {
    const result = await this.db
      .prepare(
        "SELECT version,document_json,created_at,reason FROM revisions WHERE post_id=? ORDER BY version DESC LIMIT ?",
      )
      .bind(id, limit)
      .all<{
        version: number;
        document_json: string;
        created_at: string;
        reason: Revision["reason"];
      }>();
    return result.results.map((r) => ({
      version: r.version,
      title: JSON.parse(r.document_json).title,
      createdAt: r.created_at,
      reason: r.reason,
    }));
  }
  async revision(id: string, version: number) {
    const row = await this.db
      .prepare(
        "SELECT document_json FROM revisions WHERE post_id=? AND version=?",
      )
      .bind(id, version)
      .first<{ document_json: string }>();
    return row ? (JSON.parse(row.document_json) as Post) : null;
  }
  private mapError(error: unknown): never {
    if (
      String(error).includes("UNIQUE constraint") ||
      String(error).includes("SLUG_RESERVED")
    )
      throw new AppError(
        409,
        "SLUG_CONFLICT",
        "That URL is already in use. Choose another slug.",
      );
    throw error;
  }
}
