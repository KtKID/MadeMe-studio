import TypeDropdown from "../../modules/article-types/TypeDropdown";
import "../../modules/article-types/styles.css";
import CoverFrame from "../../modules/cover/CoverFrame";
import { useState } from "react";
import { ArrowUpRight, Pin, Feather, SlidersHorizontal } from "lucide-react";
import { type Post, SearchBox, date, Empty } from "../shared/ui";
import {
  DEFAULT_ARTICLE_TYPES,
  type ArticleType,
} from "../../modules/article-types/contracts";
import {
  articleTypeName,
  matchesArticleType,
} from "../../modules/article-types/matching";
import { DEFAULT_CONFIG } from "../../modules/config/defaults";
export default function PublicFeed({
  posts,
  authenticated,
  types = DEFAULT_ARTICLE_TYPES,
  theme = "paper",
  cardTags = DEFAULT_CONFIG.reading.cardTags,
}: {
  posts: Post[];
  authenticated: boolean;
  types?: ArticleType[];
  theme?: "paper" | "ink" | "garden" | "mono";
  /** 设置页“嵌入与阅读 → 文章卡片显示标签数”。 */
  cardTags?: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const filtered = posts
    .filter(
      (p) =>
        matchesArticleType(p, category, types) &&
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
        <div className="category-filter article-type-filter">
          <SlidersHorizontal size={16} aria-hidden="true" />
          <TypeDropdown
            label="文章类型"
            value={category}
            onChange={setCategory}
            options={[
              { value: "", label: "全部文章" },
              ...types.map((type) => ({ value: type.id, label: type.name })),
            ]}
          />
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
                className={`article-card-visual${post.coverImage ? " has-cover" : ""}`}
                href={`/p/${post.slug}`}
                aria-label={`阅读 ${post.title}`}
              >
                {post.coverImage ? (
                  <CoverFrame
                    src={post.coverImage}
                    settings={post.coverSettings}
                    loading="lazy"
                  />
                ) : (
                  <div className={`abstract-cover cover-${index % 4}`}>
                    <span className="cover-circle" />
                    <span className="cover-line" />
                    <span className="cover-word">
                      {articleTypeName(post, types) || "NOTES"}
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
                  <span>{articleTypeName(post, types) || "随笔"}</span>
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
