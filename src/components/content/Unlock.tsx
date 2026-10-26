import { useState } from "react";
import { LockKeyhole, ArrowRight } from "lucide-react";
import { api, Busy, Notice } from "../shared/ui";
export default function Unlock({ slug }: { slug: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="unlock-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(`/api/posts/${encodeURIComponent(slug)}/unlock`, {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          location.reload();
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <span className="empty-mark">
        <LockKeyhole size={26} />
      </span>
      <h1>留给懂得的人。</h1>
      <p>这篇文章需要访问密码。</p>
      <label>
        文章密码
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <button className="button primary" disabled={busy}>
        {busy ? (
          <Busy />
        ) : (
          <>
            解锁阅读 <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  );
}
