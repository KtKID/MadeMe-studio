-- 文章访问事件：每行一次公开文章页访问，与内容同库，可整体导出迁移。
-- 不按访客去重、不做保留清理；爬虫照常入库，查询口径过滤（见 src/server/page-views.ts）。
CREATE TABLE `page_view_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ts` integer NOT NULL,
  `path` text NOT NULL,
  `ip` text,
  `country` text,
  `ua` text,
  `referer` text,
  `duration_ms` integer NOT NULL DEFAULT 0,
  `status` integer NOT NULL DEFAULT 200
);
--> statement-breakpoint
CREATE INDEX `idx_page_view_events_path_ts` ON `page_view_events` (`path`,`ts`);
--> statement-breakpoint
CREATE INDEX `idx_page_view_events_ts` ON `page_view_events` (`ts`);
