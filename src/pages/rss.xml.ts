import type { APIRoute } from "astro";
import { discover } from "../server/discovery/data";
import { buildRss } from "../server/discovery/feed";
export const GET: APIRoute = async (context) => {
  const d = await discover(context);
  return new Response(buildRss(d.origin, d.title, d.posts, d.rssItems), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
