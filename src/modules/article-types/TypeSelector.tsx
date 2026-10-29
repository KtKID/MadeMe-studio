import TypeDropdown from "./TypeDropdown";
import { useEffect, useId, useRef, useState } from "react";
import { Busy, Notice } from "../../components/shared/ui";
import {
  articleTypeNameKey,
  articleTypeNameSchema,
  type ArticleType,
} from "./contracts";
import { mutateArticleTypes, useArticleTypes } from "./client";
import { resolveArticleType } from "./matching";
import "./styles.css";

/** 新增和重命名共用同一输入协议与提交锁，服务端仍做最终唯一性校验。 */
export function TypeNameForm({
  types,
  editing,
  submitLabel,
  onDone,
  onCancel,
}: {
  types: ArticleType[];
  editing?: ArticleType;
  submitLabel: string;
  onDone: (id: string, name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const active = useRef(true);
  const id = useId();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const parsed = articleTypeNameSchema.safeParse(name);
  const duplicate =
    parsed.success &&
    types.some(
      (t) =>
        t.id !== editing?.id &&
        [t.name, ...(t.legacyNames ?? [])].some(
          (name) =>
            articleTypeNameKey(name) === articleTypeNameKey(parsed.data),
        ),
    );
  async function submit() {
    if (lock.current || !parsed.success || duplicate) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await mutateArticleTypes(
        editing
          ? { action: "rename", id: editing.id, name: parsed.data }
          : { action: "create", name: parsed.data },
      );
      const selected = result.types.find(
        (t) => t.id === (editing?.id ?? result.selectedId),
      );
      if (!selected) throw new Error("类型保存结果不完整，请刷新列表后重试。");
      if (active.current) onDone(selected.id, selected.name);
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error ? failure.message : "类型保存失败，请重试。",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="article-type-name-form">
      <label htmlFor={id}>{editing ? "类型名称" : "新类型名称"}</label>
      <div className="article-type-inline">
        <input
          id={id}
          value={name}
          autoFocus
          disabled={busy}
          placeholder="例如：设计"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="article-type-actions">
          <button
            type="button"
            className="button small"
            onClick={onCancel}
            aria-label={editing ? "取消编辑类型" : "取消新增"}
          >
            取消
          </button>
          <button
            type="button"
            className="button primary small"
            disabled={busy || !parsed.success || duplicate}
            onClick={() => void submit()}
          >
            {busy ? <Busy text="保存中" /> : submitLabel}
          </button>
        </div>
      </div>
      {duplicate && (
        <p className="article-type-hint" role="status">
          已有同名类型，请直接选择。
        </p>
      )}
      {!parsed.success && name.trim() && (
        <p className="article-type-hint" role="status">
          {parsed.error.issues[0]?.message}
        </p>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}

export default function TypeSelector({
  initialTypes,
  value,
  legacyName,
  onChange,
  disabled = false,
}: {
  initialTypes: ArticleType[];
  value: string | null | undefined;
  legacyName: string;
  onChange: (id: string | null, name: string) => void;
  disabled?: boolean;
}) {
  const { types, loading, error, refresh } = useArticleTypes(initialTypes);
  const [adding, setAdding] = useState(false);
  const id = useId();
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    if (disabled) setAdding(false);
  }, [disabled]);
  const configured = resolveArticleType(
    { category: legacyName, categoryId: value },
    types,
  );
  const legacy = !configured && !!legacyName;
  const selected = configured?.id ?? (legacy ? "__legacy__" : "");
  return (
    <div className="article-type-selector">
      <label htmlFor={id}>文章类型</label>
      <TypeDropdown
        label="文章类型"
        id={id}
        value={selected}
        disabled={disabled}
        onChange={(nextValue) => {
          if (nextValue === "__create__") {
            setAdding(true);
            return;
          }
          if (nextValue === "__legacy__") return;
          setAdding(false);
          const type = types.find((t) => t.id === nextValue);
          onChange(type?.id ?? null, type?.name ?? "");
        }}
        options={[
          { value: "", label: "未分类" },
          ...(legacy
            ? [{ value: "__legacy__", label: `${legacyName}（原分类）` }]
            : []),
          ...types.map((t) => ({ value: t.id, label: t.name })),
          { value: "__create__", label: "＋ 新增类型…" },
        ]}
      />
      {loading && (
        <span className="article-type-hint" role="status">
          正在更新类型…
        </span>
      )}
      {error && (
        <div className="article-type-load-error">
          <Notice kind="error">{error}</Notice>
          <button
            type="button"
            className="button small"
            onClick={() => void refresh()}
          >
            重试加载
          </button>
        </div>
      )}
      {adding && !disabled && (
        <TypeNameForm
          types={types}
          submitLabel="添加并选中"
          onCancel={() => setAdding(false)}
          onDone={(nextId, name) => {
            if (!disabledRef.current) onChange(nextId, name);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
