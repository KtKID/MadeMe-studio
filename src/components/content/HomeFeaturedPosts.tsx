import { Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Post } from "../../shared/contracts";
import type { ArticleType } from "../../modules/article-types/contracts";
import { articleTypeName } from "../../modules/article-types/matching";
import { date } from "../shared/ui";
import HomeCover from "./HomeCover";
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
    <article
      className={`article-card home-post home-post--${variant}`}
      data-featured-index={variant === "grid" ? undefined : index}
    >
      <a
        className="home-post-link"
        href={`/p/${post.slug}`}
        aria-label={`阅读 ${post.title}`}
      >
        {/* 首页按位置定义画框，复用作者焦点；不覆盖文章页的封面比例。 */}
        <div
          className={`article-card-visual${post.coverImage ? " has-cover" : ""}`}
        >
          {post.coverImage ? (
            <HomeCover
              src={post.coverImage}
              settings={post.coverSettings}
              publiclyVisible={post.visibility === "public"}
              sizes={
                variant === "grid"
                  ? "(max-width: 360px) 100vw, (max-width: 960px) 50vw, 25vw"
                  : "(max-width: 680px) 100vw, 65vw"
              }
              loading={variant === "grid" ? "lazy" : "eager"}
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
          <div className="home-post-copy">
            <h2>{post.title}</h2>
            {variant === "lead" && post.excerpt && <p>{post.excerpt}</p>}
          </div>
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
  const section = useRef<HTMLElement>(null);
  const [needsStack, setNeedsStack] = useState(false);
  useEffect(() => {
    const root = section.current;
    if (!root) return;
    if (featured.length !== FEATURED_POST_COUNT) {
      setNeedsStack(false);
      return;
    }
    if (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      !CSS.supports("grid-template-rows", "subgrid")
    ) {
      setNeedsStack(true);
      return;
    }
    if (typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let previousWidth = root.clientWidth;
    const measure = () => {
      if (disposed || !root.isConnected) return;
      const width = root.clientWidth;
      if (width <= 0) return;
      const grid = root.querySelector<HTMLElement>(".home-featured-grid");
      const source = root.querySelector<HTMLElement>(
        '[data-featured-index="1"]',
      );
      // 版面或样式尚未齐备时使用可读的纵向布局，不构造无效测量尺寸。
      if (!grid || !source) {
        setNeedsStack(true);
        return;
      }
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      // 读取 CSS 的列比例和最低展示比例；不用标题字符数猜测实际换行。
      const css = getComputedStyle(root);
      const ratio = parseFloat(css.getPropertyValue("--featured-column-ratio"));
      const minAspect = parseFloat(
        css.getPropertyValue("--featured-max-crop-ratio"),
      );
      if (
        !Number.isFinite(ratio) ||
        ratio <= 0 ||
        !Number.isFinite(minAspect) ||
        minAspect <= 0 ||
        width <= gap
      ) {
        setNeedsStack(true);
        return;
      }
      const sideWidth = (width - gap) / (1 + ratio);
      const leadHeight = (sideWidth * ratio) / (3 / 2);
      const clone = source.cloneNode(true) as HTMLElement;
      clone.classList.add("home-featured-measure");
      clone.setAttribute("aria-hidden", "true");
      clone.inert = true;
      clone.style.width = `${sideWidth}px`;
      root.appendChild(clone);
      const middle = clone.querySelector<HTMLElement>(".article-card-body");
      if (!middle) {
        clone.remove();
        setNeedsStack(true);
        return;
      }
      let middleHeight: number;
      try {
        middleHeight = middle.getBoundingClientRect().height;
      } finally {
        clone.remove();
      }
      setNeedsStack((leadHeight - middleHeight) / 2 < sideWidth / minAspect);
    };
    const observer = new ResizeObserver(() => {
      if (root.clientWidth !== previousWidth) {
        previousWidth = root.clientWidth;
        measure();
      }
    });
    observer.observe(root);
    measure();
    void document.fonts?.ready.then(() => {
      if (root.isConnected) measure();
    });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [featured.map((post) => `${post.id}:${post.title}`).join("|")]);
  return (
    <>
      <section
        ref={section}
        className={`home-featured${needsStack ? " home-featured--stacked" : ""}`}
        aria-label="重点文章"
        data-count={featured.length}
      >
        <div className="home-featured-grid">
          {featured.map((post, index) => (
            <HomePost
              key={post.id}
              post={post}
              types={types}
              index={index}
              variant={index === 0 ? "lead" : "secondary"}
            />
          ))}
        </div>
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
