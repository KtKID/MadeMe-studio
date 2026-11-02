import type { RuntimeEnv } from "./runtime";
import { logCaught } from "../modules/log/server";

/** 一次公开文章页访问的完整事件。IP 按需求存明文，库文件整体导出即可带走。 */
export interface PageViewEvent {
  ts: number;
  path: string;
  ip: string | null;
  country: string | null;
  ua: string | null;
  referer: string | null;
  durationMs: number;
  status: number;
}

const BOT_FILTER =
  "AND (ua IS NULL OR (lower(ua) NOT LIKE '%bot%' AND lower(ua) NOT LIKE '%spider%' AND lower(ua) NOT LIKE '%crawler%'))";

/** 从请求与响应构造事件；cf 元数据仅 Cloudflare 运行时提供，本地为 null。 */
export function buildPageViewEvent(
  request: Request,
  response: Response,
  startedAt: number,
  path: string,
): PageViewEvent {
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  return {
    ts: Date.now(),
    path,
    ip: request.headers.get("cf-connecting-ip"),
    country: cf?.country ?? null,
    ua: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
    durationMs: Date.now() - startedAt,
    status: response.status,
  };
}

/** 记录一次访问；无数据库绑定（如本地无云环境）时静默跳过。 */
export async function recordPageView(
  env: RuntimeEnv,
  event: PageViewEvent,
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO page_view_events (ts, path, ip, country, ua, referer, duration_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      event.ts,
      event.path,
      event.ip,
      event.country,
      event.ua,
      event.referer,
      event.durationMs,
      event.status,
    )
    .run();
}

/**
 * 文章页阅读数：只计访客 200 响应，爬虫不计入；无绑定或查询失败（如迁移未应用）返回 null。
 * 当前未被任何页面引用（访问数据只在工作台「数据」面板展示），保留为模块能力并由测试覆盖。
 */
export async function readPostViewCount(
  env: RuntimeEnv,
  path: string,
): Promise<number | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS views FROM page_view_events WHERE path = ? AND status = 200 ${BOT_FILTER}`,
    )
      .bind(path)
      .first<{ views: number }>();
    return row ? Number(row.views) : 0;
  } catch (error) {
    logCaught("pageview.read_failed", error, { path });
    return null;
  }
}

/** 热门文章：时间窗口内按访问次数降序，口径与阅读数一致。当前未被页面引用，保留为模块能力。 */
export async function listTopPaths(
  env: RuntimeEnv,
  options: { sinceMs: number; limit: number },
): Promise<{ path: string; views: number }[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare(
    `SELECT path, COUNT(*) AS views FROM page_view_events WHERE ts >= ? AND status = 200 ${BOT_FILTER} GROUP BY path ORDER BY views DESC, path ASC LIMIT ?`,
  )
    .bind(options.sinceMs, options.limit)
    .all<{ path: string; views: number }>();
  return result.results.map((row) => ({
    path: row.path,
    views: Number(row.views),
  }));
}

export interface VisitSummary {
  /** 访问次数：口径与阅读数一致（访客 200、排除爬虫）。 */
  visits: number;
  /** 访客数：按 IP 分组去重（无 IP 的本地访问归为一组）。 */
  visitors: number;
}

/** 工作台「网站状态」汇总；无数据库绑定时返回零值。两条独立查询，避免同一参数按占位符顺序重复绑定。 */
export async function visitSummary(
  env: RuntimeEnv,
  options: { sinceMs?: number } = {},
): Promise<VisitSummary> {
  if (!env.DB) return { visits: 0, visitors: 0 };
  let timeFilter = "";
  const params: number[] = [];
  if (options.sinceMs !== undefined) {
    timeFilter = "AND ts >= ?";
    params.push(options.sinceMs);
  }
  const where = `WHERE status = 200 ${BOT_FILTER} ${timeFilter}`;
  const visitsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS visits FROM page_view_events ${where}`,
  )
    .bind(...params)
    .first<{ visits: number }>();
  const visitorsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS visitors FROM (SELECT ip FROM page_view_events ${where} GROUP BY ip)`,
  )
    .bind(...params)
    .first<{ visitors: number }>();
  return {
    visits: visitsRow ? Number(visitsRow.visits) : 0,
    visitors: visitorsRow ? Number(visitorsRow.visitors) : 0,
  };
}

export interface VisitorRow {
  ip: string | null;
  views: number;
  lastTs: number;
  country: string | null;
}

export interface VisitorsPage {
  items: VisitorRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 按 IP 汇总的访客分页列表：最近访问倒序（并列再按次数、IP 固定次序，翻页不重不漏）。
 * 国家取该 IP 最近一次访问的值（SQLite 对含单个 MAX() 的分组查询，裸列取自 MAX 所在行）。
 * 页码小于 1 归一为 1，超过总页数夹紧到最后一页，响应中的 page 为实际使用值。
 */
export async function listVisitors(
  env: RuntimeEnv,
  options: { page?: number; pageSize?: number; sinceMs?: number } = {},
): Promise<VisitorsPage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 10, 1), 100);
  const requested = Math.max(1, Math.trunc(options.page ?? 1));
  const items: VisitorRow[] = [];
  let total = 0;
  let page = 1;
  if (env.DB) {
    let timeFilter = "";
    const params: number[] = [];
    if (options.sinceMs !== undefined) {
      timeFilter = "AND ts >= ?";
      params.push(options.sinceMs);
    }
    const where = `WHERE status = 200 ${BOT_FILTER} ${timeFilter}`;
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM (SELECT ip FROM page_view_events ${where} GROUP BY ip)`,
    )
      .bind(...params)
      .first<{ total: number }>();
    total = countRow ? Number(countRow.total) : 0;
    page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
    const result = await env.DB.prepare(
      `SELECT ip, COUNT(*) AS views, MAX(ts) AS lastTs, country
       FROM page_view_events ${where}
       GROUP BY ip ORDER BY lastTs DESC, views DESC, ip ASC LIMIT ? OFFSET ?`,
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<{
        ip: string | null;
        views: number;
        lastTs: number;
        country: string | null;
      }>();
    for (const row of result.results)
      items.push({
        ip: row.ip,
        views: Number(row.views),
        lastTs: Number(row.lastTs),
        country: row.country,
      });
  }
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** 中间件专用：记录失败只写日志，绝不影响页面响应。 */
export async function recordPageViewSafely(
  env: RuntimeEnv,
  event: PageViewEvent,
): Promise<void> {
  try {
    await recordPageView(env, event);
  } catch (error) {
    logCaught("pageview.record_failed", error, {
      path: event.path,
      status: event.status,
    });
  }
}
