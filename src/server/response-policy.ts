// 动态 HTML 不共享缓存；静态哈希资源保留原缓存策略。
export function secureResponse(
  response: Response,
  url: URL,
  authMode?: string,
): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  // /api/auth/* 的 303 跳转与回调携带 code/state，必须 no-referrer；/login 用 same-origin：
  // no-referrer 会使原生表单 POST 发送 `Origin: null` 而被同源校验拒绝，same-origin 仍不向外站发送 Referer。
  response.headers.set(
    "Referrer-Policy",
    url.pathname.startsWith("/api/auth/")
      ? "no-referrer"
      : url.pathname === "/login"
        ? "same-origin"
        : "strict-origin-when-cross-origin",
  );
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (response.headers.get("Content-Type")?.includes("text/html")) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    response.headers.set(
      "Content-Security-Policy",
      "object-src 'none'; base-uri 'self'; form-action 'self'" +
        (authMode === "google" && url.pathname === "/login"
          ? " https://accounts.google.com"
          : "") +
        (["password", "google"].includes(authMode || "") &&
        (url.pathname === "/login" || url.pathname.startsWith("/studio"))
          ? "; frame-ancestors 'none'"
          : ""),
    );
  }
  if (
    url.pathname === "/login" ||
    url.pathname.startsWith("/studio") ||
    url.pathname.startsWith("/api")
  )
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

// 已知链接可访问不等于允许搜索引擎收录。
export function canIndexPost(
  post: {
    visibility: "public" | "draft" | "password" | "unlisted";
    publishedAt: string | null;
  } | null,
): boolean {
  return !!post && post.visibility === "public" && post.publishedAt !== null;
}
