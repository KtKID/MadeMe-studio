import type { APIRoute } from "astro";
import { discover } from "../server/discovery/data";
import { buildSitemap } from "../server/discovery/feed";
export const GET: APIRoute = async (context) => {
  const d = await discover(context);
  return new Response(buildSitemap(d.origin, d.posts), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
