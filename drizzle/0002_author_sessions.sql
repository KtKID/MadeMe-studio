CREATE TABLE `author_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`config_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
