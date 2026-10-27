import { useState } from "react";
import { ArrowUpRight, Pin, Feather } from "lucide-react";
import { type Post, SearchBox, date, Empty } from "../shared/ui";
import { DEFAULT_CONFIG } from "../../modules/config/defaults";
export default function PublicFeed({
  posts,
  authenticated,
  theme = "paper",
  cardTags = DEFAULT_CONFIG.reading.cardTags,
}: {
  posts: Post[];
  authenticated: boolean;
  theme?: "paper" | "ink" | "garden" | "mono";
  /** 设置页“嵌入与阅读 → 文章卡片显示标签数”。 */
  cardTags?: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(posts.map((p) => p.category).filter(Boolean))];
  const filtered = posts
    .filter(
      (p) =>
        (!category || p.category === category) &&
        `${p.title} ${p.excerpt} ${p.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        String(b.publishedAt).localeCompare(String(a.publishedAt)),
    );
  return (
    <section className="public-feed" data-layout={theme}>
      <div className="feed-toolbar">
        <div className="filter-chips">
          <button
            onClick={() => setCategory("")}
            className={!category ? "active" : ""}
          >
            全部文章 <span>{posts.length}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c}
              className={category === c ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="寻找一个想法…"
        />
      </div>
      {filtered.length ? (
        <div className="article-grid">
          {filtered.map((post, index) => (
            <article
              key={post.id}
              className={`article-card ${index === 0 ? "featured" : ""}`}
            >
              <a
                className="article-card-visual"
                href={`/p/${post.slug}`}
                aria-label={`阅读 ${post.title}`}
              >
                {post.coverImage ? (
                  <img src={post.coverImage} alt="" loading="lazy" />
                ) : (
                  <div className={`abstract-cover cover-${index % 4}`}>
                    <span className="cover-circle" />
                    <span className="cover-line" />
                    <span className="cover-word">
                      {post.category || "NOTES"}
                    </span>
                  </div>
                )}
                {post.pinned && (
                  <span className="pinned-label">
                    <Pin size={12} />
                    置顶
                  </span>
                )}
              </a>
              <div className="article-card-body">
                <div className="article-meta">
                  <span>{post.category || "随笔"}</span>
                  <span>{date(post.publishedAt)}</span>
                </div>
                <a href={`/p/${post.slug}`}>
                  <h2>{post.title}</h2>
                </a>
                <p>
                  {post.excerpt || "每一个值得记录的想法，都有它自己的故事。"}
                </p>
                <div className="article-card-bottom">
                  <div>
                    {post.tags.slice(0, cardTags).map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                  <a href={`/p/${post.slug}`} aria-label={`阅读 ${post.title}`}>
                    <ArrowUpRight size={20} />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={query ? "没有找到相关文字" : "好故事，正在酝酿"}
          action={
            authenticated ? (
              <a className="button primary" href="/studio/new">
                <Feather size={16} />
                写下第一篇文章
              </a>
            ) : undefined
          }
        >
          {query
            ? "试着换个关键词，发现另一种可能。"
            : "这里会收集认真生活留下的文字。下一次见面，或许就有了新的故事。"}
        </Empty>
      )}
    </section>
  );
}
