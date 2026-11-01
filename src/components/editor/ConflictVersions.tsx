import type { Post } from "../../shared/contracts";
import BlockReader from "../content/BlockReader";
import CoverFrame from "../../modules/cover/CoverFrame";
import { normalizeCoverSettings } from "../../modules/cover/contracts";
/** 两种状态只读展示；选择处理冲突，不调用文章删除，不额外保存副本。 */
export default function ConflictVersions({
  local,
  remote,
}: {
  local: Post;
  remote: Post;
}) {
  return (
    <div className="conflict-versions">
      {[
        { label: "A · 本地", post: local },
        { label: "B · 服务器", post: remote },
      ].map(({ label, post }) => (
        <section className="conflict-version" aria-label={label} key={label}>
          <h3>{label}</h3>
          <h4>{post.title}</h4>
          <div className="conflict-version-content">
            {post.coverImage && (
              <CoverFrame
                src={post.coverImage}
                settings={normalizeCoverSettings(post.coverSettings)}
                alt={`${label}封面`}
              />
            )}
            <dl className="muted">
              <dt>摘要</dt>
              <dd>{post.excerpt || "无"}</dd>
              <dt>分类与标签</dt>
              <dd>
                {[post.category, ...post.tags].filter(Boolean).join(" · ") ||
                  "无"}
              </dd>
              <dt>文章链接</dt>
              <dd>{post.slug}</dd>
            </dl>
            <div className="reader-content">
              {post.blocks.length ? (
                <BlockReader blocks={post.blocks} />
              ) : (
                <p className="muted">正文为空</p>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
