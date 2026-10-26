import { useEffect, useState } from "react";
import {
  KeyRound,
  Plus,
  Copy,
  Trash2,
  Check,
  PanelsTopLeft,
  BookOpen,
  Terminal,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { api, Notice, Busy, Modal, date } from "../shared/ui";
import type { APIToken, TokenScope } from "../../shared/contracts";
export default function Integrations({
  authenticated,
}: {
  authenticated: boolean;
}) {
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<TokenScope[]>([
    "posts:read",
    "posts:write",
  ]);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(location.origin);
    if (authenticated)
      api<{ tokens: APIToken[] }>("/api/tokens")
        .then((r) => setTokens(r.tokens))
        .catch((e) => setError(e.message));
  }, [authenticated]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string; metadata?: APIToken }>(
        "/api/tokens",
        {
          method: "POST",
          body: JSON.stringify({ name, scopes, expiresInDays: days }),
        },
      );
      setSecret(r.token);
      const list = await api<{ tokens: APIToken[] }>("/api/tokens");
      setTokens(list.tokens);
      setOpen(false);
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!confirm("撤销后，使用这个令牌的工具将无法再访问站点。确定继续？"))
      return;
    try {
      await api(`/api/tokens/${id}`, { method: "DELETE" });
      setTokens(tokens.filter((t) => t.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A CONNECTED WRITING LIFE</div>
          <h1>灵感，不必只在这里。</h1>
          <p>连接你熟悉的工具，把好内容带回自己的空间。</p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="integration-grid">
        <div className="integration-card">
          <span className="integration-icon">
            <PanelsTopLeft size={25} />
          </span>
          <h2>浏览器剪藏</h2>
          <p>选中文字、保留来源，整理为一篇待编辑的草稿。</p>
          <a
            className="text-button"
            href="https://github.com/KtKID/MadeMe-studio/tree/main/integrations/chrome-clipper"
            target="_blank"
            rel="noreferrer"
          >
            安装说明与源码 <ArrowUpRight size={15} />
          </a>
          <small>需要手动安装扩展并配置站点令牌</small>
        </div>
        <div className="integration-card">
          <span className="integration-icon purple">
            <BookOpen size={25} />
          </span>
          <h2>Obsidian 发布</h2>
          <p>只发布你明确选择的笔记，不读取或同步整个知识库。</p>
          <a
            className="text-button"
            href="https://github.com/KtKID/MadeMe-studio/tree/main/integrations/obsidian-publisher"
            target="_blank"
            rel="noreferrer"
          >
            查看插件源码 <ArrowUpRight size={15} />
          </a>
          <small>独立插件，需在你的设备上手动安装</small>
        </div>
        <div className="integration-card">
          <span className="integration-icon sand">
            <Terminal size={25} />
          </span>
          <h2>API 与 Agent Skill</h2>
          <p>用受限 API 把你的自动化流程接入草稿与发布。</p>
          <a
            className="text-button"
            href="https://github.com/KtKID/MadeMe-studio/tree/main/integrations"
            target="_blank"
            rel="noreferrer"
          >
            使用指南 <ArrowUpRight size={15} />
          </a>
          <small>显式授权 · 最小权限 · 随时撤销</small>
        </div>
      </div>
      <section className="content-panel token-panel">
        <div className="section-heading">
          <div>
            <h2>
              <KeyRound size={20} />
              访问令牌
            </h2>
            <p>每个工具使用独立令牌，只授予它需要的权限。</p>
          </div>
          <button
            className="button primary"
            disabled={!authenticated}
            onClick={() => setOpen(true)}
          >
            <Plus size={16} />
            创建令牌
          </button>
        </div>
        <Notice>
          <ShieldCheck size={17} />
          令牌只在创建时展示一次。请保存到工具的安全配置中，不要写进仓库、文章或截图。
        </Notice>
        {secret && (
          <div className="secret-card">
            <strong>复制并妥善保存你的令牌</strong>
            <code>{secret}</code>
            <div className="button-group">
              <button
                className="button small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret);
                    setCopied(true);
                  } catch {
                    setError("浏览器不允许自动复制，请手动选择令牌。");
                  }
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                {copied ? "已复制" : "复制令牌"}
              </button>
              <button
                className="button small"
                onClick={() => {
                  setSecret("");
                  setCopied(false);
                }}
              >
                我已保存，隐藏令牌
              </button>
            </div>
          </div>
        )}
        {tokens.length ? (
          <div className="token-list">
            {tokens.map((t) => (
              <div key={t.id}>
                <span className="token-icon">
                  <KeyRound size={19} />
                </span>
                <div>
                  <strong>{t.name}</strong>
                  <p>{t.scopes.join(" · ")}</p>
                  <small>
                    有效期至 {date(t.expiresAt)} ·{" "}
                    {t.lastUsedAt
                      ? `最近使用 ${date(t.lastUsedAt)}`
                      : "尚未使用"}
                  </small>
                </div>
                <button
                  className="icon-button danger"
                  title="撤销令牌"
                  onClick={() => revoke(t.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            还没有访问令牌。手动创建后，外部工具才能访问你的站点。
          </p>
        )}
        <div className="api-example">
          <span>你的站点 API</span>
          <code>{origin}/api/posts</code>
        </div>
      </section>
      {open && (
        <Modal title="为一个工具创建访问令牌" onClose={() => setOpen(false)}>
          <label>
            用途名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的 Obsidian"
            />
          </label>
          <label>
            有效天数
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(+e.target.value)}
            />
          </label>
          <fieldset className="scope-options">
            <legend>允许的操作</legend>
            {(
              [
                ["posts:read", "读取文章"],
                ["posts:write", "创建与修改草稿"],
                ["posts:publish", "发布文章（高权限）"],
                ["media:write", "上传媒体"],
              ] as [TokenScope, string][]
            ).map(([scope, label]) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(e) =>
                    setScopes(
                      e.target.checked
                        ? [...scopes, scope]
                        : scopes.filter((s) => s !== scope),
                    )
                  }
                />
                {label}
                <code>{scope}</code>
              </label>
            ))}
          </fieldset>
          <div className="modal-actions">
            <button className="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy || !name.trim() || !scopes.length}
              onClick={create}
            >
              {busy ? <Busy /> : "创建令牌"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
