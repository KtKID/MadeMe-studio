import type { APIRoute } from "astro";
// robots 不是权限控制；敏感内容仍必须由服务端鉴权。
export const GET: APIRoute = ({ url }) =>
  new Response(
    `User-agent: *\nAllow: /\nDisallow: /studio\nDisallow: /api\nSitemap: ${url.origin}/sitemap.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
