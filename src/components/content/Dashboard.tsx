import {
  postSummarySchema,
  type PostSummary,
  type DashboardBootstrap,
} from "../../shared/contracts";
import { useNavigationReady } from "../../modules/navigation-performance/use-navigation-ready";
import { useMemo, useRef, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  FileText,
  Globe2,
  PenLine,
  Pin,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
  ArrowRight,
} from "lucide-react";
import {
  api,
  type Post,
  date,
  visibilityLabels,
  SearchBox,
  Notice,
  Empty,
  Busy,
} from "../shared/ui";
export default function Dashboard({
  initial,
  initialError = "",
}: {
  initial: DashboardBootstrap;
  initialError?: string;
}) {
  useNavigationReady("/studio", true, !!initialError);
  const [posts, setPosts] = useState(initial.posts);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Set<string>());
  const live = posts.filter((p) => !p.deletedAt);
  const categories = useMemo(
    () => [...new Set(live.map((p) => p.category).filter(Boolean))],
    [posts],
  );
  const filtered = posts
    .filter(
      (p) =>
        (tab === "trash" ? !!p.deletedAt : !p.deletedAt) &&
        (tab !== "draft" || p.visibility === "draft") &&
        (tab !== "published" || !!p.publishedAt) &&
        (!category || p.category === category) &&
        `${p.title} ${p.excerpt} ${p.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  async function update(
    post: PostSummary,
    action: "pin" | "trash" | "restore",
  ) {
    if (!initial.capabilities.authenticated || pending.current.has(post.id))
      return;
    if (
      action === "trash" &&
      !confirm(
        `将「${post.title || "未命名文章"}」移到回收站？公开页面将不再可见。`,
      )
    )
      return;
    // 同一文章同步上锁，跨行请求各自保留忙碌状态。
    pending.current.add(post.id);
    setBusy(new Set(pending.current));
    setError("");
    try {
      if (action === "trash") {
        const result = await api<{ post: Post }>(`/api/posts/${post.id}`, {
          method: "DELETE",
          body: JSON.stringify({ version: post.version }),
        });
        setPosts((previous) =>
          previous.map((p) =>
            p.id === post.id ? postSummarySchema.parse(result.post) : p,
          ),
        );
      } else {
        const { post: next } = await api<{ post: Post }>(
          `/api/posts/${post.id}${action === "restore" ? "/restore" : ""}`,
          {
            method: action === "restore" ? "POST" : "PATCH",
            body: JSON.stringify(
              action === "pin"
                ? { version: post.version, pinned: !post.pinned }
                : { version: post.version },
            ),
          },
        );
        setPosts((previous) =>
          previous.map((p) =>
            p.id === post.id ? postSummarySchema.parse(next) : p,
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current.delete(post.id);
      setBusy(new Set(pending.current));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORDS, YOUR WORLD</div>
          <h1>让想法，慢慢成篇。</h1>
          <p>从第一行文字开始，到每一次真诚的分享。</p>
        </div>
        <a href="/studio/new" className="button primary">
          <Plus size={17} />
          写新文章
        </a>
      </div>
      {!initial.capabilities.authenticated && (
        <Notice>
          当前为只读模式。请在受信任的站点身份下登录作者账号后管理文章。
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-icon">
            <FileText size={19} />
          </span>
          <div>
            <span>全部文章</span>
            <strong>
              {live.length}
              <small>篇</small>
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <Globe2 size={19} />
          </span>
          <div>
            <span>已经发布</span>
            <strong>
              {live.filter((p) => p.publishedAt).length}
              <small>篇</small>
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <PenLine size={19} />
          </span>
          <div>
            <span>慢慢酝酿</span>
            <strong>
              {live.filter((p) => p.visibility === "draft").length}
              <small>篇草稿</small>
            </strong>
          </div>
        </div>
        <a className="stat-card inspiration" href="/studio/new">
          <span className="serif">
            「写下来，
            <br />
            就不会被遗忘。」
          </span>
          <ArrowUpRight size={24} />
        </a>
      </div>
      <section className="content-panel">
        <div className="panel-top">
          <div className="tabs" role="tablist" aria-label="文章状态">
            {[
              ["all", "全部文章"],
              ["published", "已发布"],
              ["draft", "草稿"],
              ["trash", "回收站"],
            ].map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={tab === v}
                className={tab === v ? "active" : ""}
                onClick={() => setTab(v)}
              >
                {label}
                {v === "all" && <span>{live.length}</span>}
              </button>
            ))}
          </div>
          <div className="list-tools">
            <SearchBox value={query} onChange={setQuery} />
            <label className="category-filter">
              <SlidersHorizontal size={16} />
              <select
                aria-label="按分类筛选"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {filtered.length ? (
          <>
            <div className="post-table-label">
              <span>文章</span>
              <span>状态</span>
              <span>最后更新</span>
              <span>操作</span>
            </div>
            <div className="post-list">
              {filtered.map((p) => (
                <article className="post-row" key={p.id}>
                  <a className="post-main" href={`/studio/edit?id=${p.id}`}>
                    <div className="post-thumb">
                      {p.coverImage ? (
                        <img src={p.coverImage} alt="" loading="lazy" />
                      ) : (
                        <FileText size={23} />
                      )}
                    </div>
                    <div>
                      <h3>
                        {p.pinned && <Pin size={13} />}{" "}
                        {p.title || "未命名文章"}
                      </h3>
                      <p>
                        {p.category || "未分类"} <span>·</span>{" "}
                        {p.excerpt || "还没有摘要，给这篇文章留一句引言。"}
                      </p>
                    </div>
                  </a>
                  <span
                    className={`status-pill ${p.publishedAt ? "published" : ""}`}
                  >
                    {p.deletedAt ? "回收站" : visibilityLabels[p.visibility]}
                  </span>
                  <time>{date(p.updatedAt)}</time>
                  <div className="row-actions">
                    {busy.has(p.id) ? (
                      <Busy text="" />
                    ) : p.deletedAt ? (
                      <button
                        className="icon-button"
                        title="恢复文章"
                        onClick={() => update(p, "restore")}
                      >
                        <RotateCcw size={17} />
                      </button>
                    ) : (
                      <>
                        <button
                          className={`icon-button ${p.pinned ? "selected" : ""}`}
                          title={p.pinned ? "取消置顶" : "置顶文章"}
                          onClick={() => update(p, "pin")}
                        >
                          <Pin size={16} />
                        </button>
                        <a
                          className="icon-button"
                          title="编辑文章"
                          href={`/studio/edit?id=${p.id}`}
                        >
                          <PenLine size={16} />
                        </a>
                        <button
                          className="icon-button danger"
                          title="移入回收站"
                          onClick={() => update(p, "trash")}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <Empty
            title={
              query
                ? "没有找到这篇文章"
                : tab === "trash"
                  ? "回收站很干净"
                  : "你的下一篇好文章，从这里开始"
            }
            action={
              tab !== "trash" && (
                <a href="/studio/new" className="button primary">
                  <Plus size={16} />
                  开始写作
                </a>
              )
            }
          >
            {query
              ? "换一个关键词，或看看其他分类。"
              : tab === "trash"
                ? "删除的文章会保留在这里，随时可以恢复。"
                : "这里还没有文章。把一个灵感、一段经历，或一个新发现写下来。"}
          </Empty>
        )}
        <div className="panel-footer">
          <span>{filtered.length} 篇文章 · 数据来自你的内容库</span>
          <a href="/">
            浏览站点 <ArrowRight size={14} />
          </a>
        </div>
      </section>
      <div className="quiet-note">
        <span className="small-star">✧</span>
        <div>
          <strong>专注写作，其余交给这里。</strong>
          <p>块编辑、Markdown 导入、媒体管理与 AI 助手，陪你从灵感走到发布。</p>
        </div>
        <a href="/studio/integrations">
          了解连接方式 <ArrowRight size={16} />
        </a>
      </div>
    </>
  );
}
