import { useEffect, useState } from "react";
import type { z } from "zod";
import { Eye, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { api, Notice, Busy, date } from "../shared/ui";
import { useStudioPane } from "../../modules/studio-navigation/pane";
import { useNavigationReady } from "../../modules/navigation-performance/use-navigation-ready";
import { clientCaught } from "../../modules/log/client";
import type {
  visitSummaryResponseSchema,
  visitorsResponseSchema,
} from "../../shared/contracts";

// 类型直接取自共享协议，避免与 contracts / 服务端模块三处平行定义漂移。
type VisitSummary = z.infer<typeof visitSummaryResponseSchema>;
type VisitorsPage = z.infer<typeof visitorsResponseSchema>;

// 本期只有「网站状态」；横向 tab 预留扩展位，后续数据视图按序追加。
const tabs = [{ id: "site", label: "网站状态" }] as const;
type TabId = (typeof tabs)[number]["id"];

/** 工作台「数据」面板：访问数据全站唯一展示处，访客不可见。 */
export default function DataStudio() {
  const { active } = useStudioPane();
  const [tab, setTab] = useState<TabId>("site");
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [visitors, setVisitors] = useState<VisitorsPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [visitorsLoading, setVisitorsLoading] = useState(true);
  const loading = summaryLoading || visitorsLoading;
  useNavigationReady("/studio/data", !loading, !!error);

  // 汇总与分页列表分开请求：翻页只重新拉列表，不重复拉汇总。
  // 面板失活或依赖变化时由 cleanup 作废迟到的响应，不把旧数据写进新状态。
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setSummaryLoading(true);
    setError("");
    api<VisitSummary>("/api/views/summary")
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        clientCaught("datastudio.summary_failed", e);
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setVisitorsLoading(true);
    setError("");
    api<VisitorsPage>(`/api/views/visitors?page=${page}`)
      .then((v) => {
        if (!cancelled) setVisitors(v);
      })
      .catch((e) => {
        clientCaught("datastudio.visitors_failed", e);
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setVisitorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, page]);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">NUMBERS BEHIND WORDS</div>
          <h1>数据。</h1>
          <p>谁读过这些文字，只在这里可见。</p>
        </div>
      </div>
      <div className="data-tabs" role="tablist" aria-label="数据视图">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? (
        <Notice>{error}</Notice>
      ) : !summary ? (
        <Busy />
      ) : tab === "site" ? (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-icon green">
                <Users size={19} />
              </span>
              <div>
                <span>访客数（去重 IP）</span>
                <strong>
                  {summary.visitors}
                  <small>人</small>
                </strong>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Eye size={19} />
              </span>
              <div>
                <span>访问次数</span>
                <strong>
                  {summary.visits}
                  <small>次</small>
                </strong>
              </div>
            </div>
          </div>
          <section className="content-panel data-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>IP</th>
                  <th>访问次数</th>
                  <th>最近访问</th>
                  <th>国家 / 地区</th>
                </tr>
              </thead>
              <tbody>
                {visitors?.items.map((row, index) => (
                  <tr key={`${row.ip ?? "unknown"}-${index}`}>
                    <td>{row.ip ?? "未知"}</td>
                    <td>{row.views}</td>
                    <td>{date(new Date(row.lastTs).toISOString())}</td>
                    <td>{row.country ?? "—"}</td>
                  </tr>
                ))}
                {visitors && visitors.items.length === 0 && (
                  <tr>
                    <td colSpan={4}>还没有访客记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
            {visitors && visitors.totalPages > 1 && (
              <div className="data-pagination">
                <button
                  type="button"
                  className="button small"
                  disabled={loading || visitors.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} />
                  上一页
                </button>
                <span>
                  第 {visitors.page} / {visitors.totalPages} 页 · 共{" "}
                  {visitors.total} 个 IP
                </span>
                <button
                  type="button"
                  className="button small"
                  disabled={loading || visitors.page >= visitors.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
