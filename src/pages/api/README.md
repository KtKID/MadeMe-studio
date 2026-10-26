# HTTP API 入口

`[...path].ts` 仅将 Astro 请求交给服务端编排，不包含业务逻辑。请求与返回字段以 [`共享协议`](../../shared/README.md) 为准。

文章写入需要 version，失配返回 409。API Token 必须显式携带 Bearer；浏览器会话写入必须同源。跨域集成只开放无凭据 Bearer 请求，绝不开放 Cookie 的跨域作者访问。

主要端点：bootstrap、identity、posts、posts/:id/publish、unpublish、restore、revisions、unlock、settings、media、files/:id、ai、images/generate、providers/:id/models、tokens。

Markdown 发布集成创建草稿时可提交 `{title, markdown, visibility:"draft"}`，也可提交 canonical `blocks`，二者不可同时非空。发布必须另行调用 publish 并具有 `posts:publish` scope。
