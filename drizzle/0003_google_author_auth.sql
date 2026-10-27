-- OAuth 临时流程含 PKCE verifier，十分钟到期并原子单次消费；不保存 Google 令牌。
CREATE TABLE `google_auth_flows` (
 `state_hash` text PRIMARY KEY NOT NULL,
 `browser_hash` text NOT NULL,
 `verifier` text NOT NULL,
 `nonce` text NOT NULL,
 `return_to` text NOT NULL,
 `config_version` text NOT NULL,
 `expires_at` integer NOT NULL
);
CREATE INDEX `google_auth_flows_expiry` ON `google_auth_flows` (`expires_at`);
CREATE TABLE `google_author_sessions` (
 `token_hash` text PRIMARY KEY NOT NULL,
 `config_version` text NOT NULL,
 `created_at` integer NOT NULL,
 `expires_at` integer NOT NULL,
 `revoked_at` integer
);
