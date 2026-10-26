PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, published_slug TEXT UNIQUE,
  document_json TEXT NOT NULL, published_json TEXT,
  password_hash TEXT, published_password_hash TEXT,
  version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, mutation_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_updated ON posts(updated_at DESC);
CREATE TABLE IF NOT EXISTS revisions (
  post_id TEXT NOT NULL REFERENCES posts(id), version INTEGER NOT NULL,
  document_json TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY(post_id, version)
);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), document_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, post_id TEXT REFERENCES posts(id),
  source TEXT NOT NULL DEFAULT 'upload', prompt TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_created ON media(created_at DESC);
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  last_used_at TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);

-- 同一文章可同时保留草稿 URL 与已发布 URL；其他文章不能抢占任一 URL。
CREATE TRIGGER IF NOT EXISTS posts_reserve_slug_insert
BEFORE INSERT ON posts
WHEN EXISTS (SELECT 1 FROM posts WHERE slug = NEW.slug OR published_slug = NEW.slug)
BEGIN
  SELECT RAISE(ABORT, 'SLUG_RESERVED');
END;
CREATE TRIGGER IF NOT EXISTS posts_reserve_slug_update
BEFORE UPDATE OF slug, published_slug ON posts
WHEN EXISTS (
  SELECT 1 FROM posts WHERE id <> NEW.id AND (
    slug = NEW.slug OR published_slug = NEW.slug OR
    (NEW.published_slug IS NOT NULL AND (slug = NEW.published_slug OR published_slug = NEW.published_slug))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'SLUG_RESERVED');
END;
