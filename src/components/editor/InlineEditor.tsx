import { useRef, useState } from "react";
import { PenLine } from "lucide-react";
import Editor from "./Editor";
import { api, type Post, type Settings, Notice, Busy } from "../shared/ui";
/** 阅读始终保留服务端生成的快照；只有作者主动编辑时才请求最新草稿。 */
export default function InlineEditor({
  id,
  settings,
  aiConfigured,
  imageConfigured,
}: {
  id: string;
  settings: Settings;
  aiConfigured: boolean;
  imageConfigured: boolean;
}) {
  const publishedSlug = useRef<string | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ post: Post }>(`/api/posts/${id}`);
      setPost(result.post);
      const reading = document.getElementById("article-reading");
      if (reading) reading.hidden = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (publishedSlug.current) {
      window.location.assign(`/p/${encodeURIComponent(publishedSlug.current)}`);
      return;
    }
    setPost(null);
    const reading = document.getElementById("article-reading");
    if (reading) reading.hidden = false;
  }
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {post ? (
        <Editor
          post={post}
          settings={settings}
          authenticated
          aiConfigured={aiConfigured}
          imageConfigured={imageConfigured}
          inline
          onClose={close}
          onPublished={(value) => {
            publishedSlug.current = value.slug;
          }}
        />
      ) : (
        <div className="author-reading-bar">
          <span>你正在查看读者看到的版本</span>
          <button className="button small" onClick={open} disabled={busy}>
            {busy ? (
              <Busy />
            ) : (
              <>
                <PenLine size={15} />
                编辑这篇文章
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}
