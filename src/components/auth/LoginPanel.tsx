import { useEffect, useRef, useState, type SubmitEvent } from "react";
import type { z } from "zod";
import { authSessionResponseSchema, safeReturnTo } from "../../shared/auth";
import { loginAuthor, logoutAuthor } from "./client";
type Props = {
  session: z.infer<typeof authSessionResponseSchema>;
  returnTo: string;
  secureTransport?: boolean;
};
export default function LoginPanel({
  session,
  returnTo,
  secureTransport = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      // 密码不进入 React 状态或浏览器存储；提交后立即清空输入。
      const request = loginAuthor({
        email: form.get("email"),
        password: form.get("password"),
        returnTo: safeReturnTo(returnTo),
      });
      form.delete("password");
      if (passwordInput.current) passwordInput.current.value = "";
      window.location.assign(await request);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录未完成，请重试。");
      passwordInput.current?.focus();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    if (inFlight.current || !window.confirm("确定退出作者账号吗？")) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await logoutAuthor();
      window.location.replace("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "退出未完成，请重试。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (session.mode === "sites")
    return (
      <section>
        <h1>作者访问</h1>
        <p>本站使用平台登录，无需再输入一套网站密码。</p>
        <p>作者权限由站点配置核验；未获得权限时请联系站点维护者。</p>
        <a className="button primary" href="/studio">
          返回写作台
        </a>
      </section>
    );
  if (session.mode === "password" && !secureTransport)
    return (
      <section>
        <h1>请使用安全连接</h1>
        <p role="status">
          作者登录仅支持 HTTPS。请通过本站 HTTPS 地址访问后再输入密码。
        </p>
      </section>
    );
  if (session.mode !== "password" || !session.configured)
    return (
      <section>
        <h1>作者登录暂不可用</h1>
        <p role="status">
          本站尚未完成独立作者登录配置，当前不能登录。请联系站点维护者完成配置。
        </p>
        <a href="/">返回站点</a>
      </section>
    );
  return (
    <section aria-busy={busy}>
      <h1>{session.authenticated ? "作者账号" : "登录写作台"}</h1>
      <p>
        {session.authenticated
          ? "你已通过作者身份验证。"
          : "仅供站点作者使用，不开放注册。"}
      </p>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {session.authenticated ? (
        <div className="auth-actions">
          <a className="button primary" href={safeReturnTo(returnTo)}>
            继续写作
          </a>
          <button
            type="button"
            className="button"
            disabled={busy || !ready}
            onClick={signOut}
          >
            {busy ? "正在退出…" : "退出作者账号"}
          </button>
        </div>
      ) : (
        <form method="post" action="/api/auth/login" onSubmit={submit}>
          <label htmlFor="author-email">作者邮箱</label>
          <input
            id="author-email"
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            required
            disabled={busy || !ready}
          />
          <label htmlFor="author-password">密码</label>
          <input
            ref={passwordInput}
            id="author-password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
            disabled={busy || !ready}
          />
          <button
            className="button primary"
            type="submit"
            disabled={busy || !ready}
          >
            {busy ? "正在登录…" : "登录"}
          </button>
          <p role="status" aria-live="polite">
            {busy
              ? "正在核验身份，请稍候。"
              : "密码不会保存在本站的浏览器存储中。"}
          </p>
        </form>
      )}
    </section>
  );
}
