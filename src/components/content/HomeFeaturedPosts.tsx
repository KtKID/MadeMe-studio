import { Pin } from "lucide-react";
import type { Post } from "../../shared/contracts";
import type { ArticleType } from "../../modules/article-types/contracts";
import { articleTypeName } from "../../modules/article-types/matching";
import { date } from "../shared/ui";
import "./home-featured-posts.css";

// 这是刊物的版面容量；选取沿用 PublicFeed 的置顶/发布时间排序。
const FEATURED_POST_COUNT = 3;

function HomePost({
  post,
  types,
  index,
  variant,
}: {
  post: Post;
  types: ArticleType[];
  index: number;
  variant: "lead" | "secondary" | "grid";
}) {
  const typeName = articleTypeName(post, types) || "随笔";
  return (
    <article className={`article-card home-post home-post--${variant}`}>
      <a
        className="home-post-link"
        href={`/p/${post.slug}`}
        aria-label={`阅读 ${post.title}`}
      >
        <div className="article-card-visual">
          {post.coverImage ? (
            <img
              src={post.coverImage}
              alt=""
              loading={variant === "grid" ? "lazy" : "eager"}
              decoding="async"
            />
          ) : (
            <div
              className={`abstract-cover cover-${index % 4}`}
              aria-hidden="true"
            >
              <span className="cover-circle" />
              <span className="cover-line" />
              <span className="cover-word">{typeName}</span>
            </div>
          )}
          {post.pinned && (
            <span className="pinned-label">
              <Pin size={12} aria-hidden="true" />
              置顶
            </span>
          )}
        </div>
        <div className="article-card-body">
          {variant !== "grid" && (
            <div className="article-meta">
              <span>{typeName}</span>
              <span>{date(post.publishedAt)}</span>
            </div>
          )}
          <h2>{post.title}</h2>
          {variant === "lead" && post.excerpt && <p>{post.excerpt}</p>}
        </div>
      </a>
    </article>
  );
}

/** 只负责展示分组，不改变发布排序、可见性或后台置顶能力。 */
export default function HomeFeaturedPosts({
  posts,
  types,
}: {
  posts: Post[];
  types: ArticleType[];
}) {
  const featured = posts.slice(0, FEATURED_POST_COUNT);
  const remaining = posts.slice(FEATURED_POST_COUNT);
  return (
    <>
      <section
        className="home-featured"
        aria-label="重点文章"
        data-count={featured.length}
      >
        {featured.map((post, index) => (
          <HomePost
            key={post.id}
            post={post}
            types={types}
            index={index}
            variant={index === 0 ? "lead" : "secondary"}
          />
        ))}
      </section>
      {remaining.length > 0 && (
        <section className="home-more" aria-label="更多文章">
          <div className="home-more-heading">
            <span>更多文章</span>
            <span>{remaining.length} 篇</span>
          </div>
          <div className="home-post-grid">
            {remaining.map((post, index) => (
              <HomePost
                key={post.id}
                post={post}
                types={types}
                index={index + FEATURED_POST_COUNT}
                variant="grid"
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
