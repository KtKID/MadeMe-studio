import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Busy, Modal, Notice } from "../../components/shared/ui";
import type { ArticleType } from "./contracts";
import { mutateArticleTypes, useArticleTypes } from "./client";
import { TypeNameForm } from "./TypeSelector";
import "./styles.css";

export default function TypeSettings({
  initialTypes,
  disabled = false,
}: {
  initialTypes: ArticleType[];
  disabled?: boolean;
}) {
  const { types, loading, error, refresh } = useArticleTypes(initialTypes);
  const [editing, setEditing] = useState<ArticleType | "new" | null>(null);
  const [removing, setRemoving] = useState<ArticleType | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  async function remove() {
    if (!removing || lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setFailure("");
    try {
      await mutateArticleTypes({ action: "delete", id: removing.id });
      setRemoving(null);
      setMessage("类型已删除。");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="article-type-settings">
      <div className="article-type-heading">
        <div>
          <h2>文章类型</h2>
          <p>
            首页和文章编辑器共用此列表，新增和修改即时保存。标签仍单独管理。
          </p>
        </div>
        <button
          type="button"
          className="button small"
          disabled={disabled || !!editing || busy}
          onClick={() => {
            setEditing("new");
            setMessage("");
          }}
        >
          <Plus size={15} />
          新增类型
        </button>
      </div>
      {loading && (
        <span className="article-type-hint" role="status">
          正在更新类型…
        </span>
      )}
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          <button
            type="button"
            className="button small"
            onClick={() => void refresh()}
          >
            重试加载
          </button>
        </>
      )}
      {!types.length && !loading && (
        <p className="article-type-hint">暂无类型，首页仍可查看全部文章。</p>
      )}
      <ul className="article-type-list">
        {types.map((type) => (
          <li key={type.id}>
            <span>{type.name}</span>
            <div className="article-type-actions">
              <button
                type="button"
                className="button small"
                aria-label={`编辑${type.name}`}
                disabled={disabled || !!editing || busy}
                onClick={() => {
                  setEditing(type);
                  setMessage("");
                }}
              >
                <Pencil size={14} />
                编辑
              </button>
              <button
                type="button"
                className="button small"
                aria-label={`删除${type.name}`}
                disabled={disabled || !!editing || busy}
                onClick={() => {
                  setRemoving(type);
                  setFailure("");
                  setMessage("");
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && !disabled && (
        <TypeNameForm
          key={editing === "new" ? "new" : editing.id}
          types={types}
          editing={editing === "new" ? undefined : editing}
          submitLabel={editing === "new" ? "添加类型" : "保存名称"}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setMessage("类型已保存。");
          }}
        />
      )}
      {message && (
        <p role="status" className="article-type-hint">
          {message}
        </p>
      )}
      {removing &&
        typeof document !== "undefined" &&
        createPortal(
          <Modal
            title="删除文章类型"
            onClose={() => {
              if (!busy) setRemoving(null);
            }}
          >
            <p>删除“{removing.name}”？已有文章使用时无法删除。</p>
            {failure && <Notice kind="error">{failure}</Notice>}
            <div className="article-type-actions article-type-dialog-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || disabled}
                onClick={() => void remove()}
              >
                {busy ? <Busy text="删除中" /> : "删除类型"}
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </section>
  );
}
