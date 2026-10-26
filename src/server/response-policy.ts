// 动态 HTML 不共享缓存；静态哈希资源保留原缓存策略。
export function secureResponse(response: Response, url: URL): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (response.headers.get("Content-Type")?.includes("text/html")) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    response.headers.set(
      "Content-Security-Policy",
      "object-src 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  if (url.pathname.startsWith("/studio") || url.pathname.startsWith("/api"))
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}
