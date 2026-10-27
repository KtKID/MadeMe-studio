import type { Post } from "../../shared/contracts";
import { DEFAULT_CONFIG } from "../../modules/config";

// 发现入口只输出公开发布快照，不能输出作者草稿或隐藏链接。
function visible(posts: Post[]): Post[] {
  return posts.filter(
    (p) =>
      p.visibility === "public" &&
      p.publishedAt !== null &&
      p.deletedAt === null,
  );
}
export function xml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
export function buildRss(
  origin: string,
  title: string,
  posts: Post[],
  limit = DEFAULT_CONFIG.reading.rssItems,
): string {
  // 按发布时间取最近 limit 篇（列表本身按更新时间排序）。
  const items = visible(posts)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, limit)
    .map((p) => {
      const url = new URL(`/p/${encodeURIComponent(p.slug)}`, origin).href;
      return `<item><title>${xml(p.title)}</title><link>${xml(url)}</link><guid isPermaLink="true">${xml(url)}</guid><description>${xml(p.excerpt)}</description><pubDate>${new Date(p.publishedAt!).toUTCString()}</pubDate></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(title)}</title><link>${xml(origin)}</link><description>${xml(title)}</description>${items}</channel></rss>`;
}
export function buildSitemap(origin: string, posts: Post[]): string {
  const urls = [
    `<url><loc>${xml(new URL("/", origin).href)}</loc></url>`,
    ...visible(posts).map(
      (p) =>
        `<url><loc>${xml(new URL(`/p/${encodeURIComponent(p.slug)}`, origin).href)}</loc><lastmod>${xml(p.updatedAt)}</lastmod></url>`,
    ),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
