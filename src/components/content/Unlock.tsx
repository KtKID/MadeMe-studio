import { useRef, useState } from "react";
import { unlockInputSchema } from "../../shared/contracts";
import { LockKeyhole, ArrowRight } from "lucide-react";
import { api, Busy, Notice } from "../shared/ui";
export default function Unlock({ slug }: { slug: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  return (
    <form
      className="unlock-card"
      onSubmit={async (e) => {
        e.preventDefault();
        // 同步锁覆盖同帧重复提交，不能只依赖下一次渲染的 disabled。
        if (inFlight.current) return;
        const request = unlockInputSchema.safeParse({ password });
        if (!request.success || !password.length) {
          setError("请输入有效的文章密码。");
          return;
        }
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
          await api(`/api/posts/${encodeURIComponent(slug)}/unlock`, {
            method: "POST",
            body: JSON.stringify(request.data),
          });
          location.reload();
        } catch (e) {
          setError((e as Error).message);
          inFlight.current = false;
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
