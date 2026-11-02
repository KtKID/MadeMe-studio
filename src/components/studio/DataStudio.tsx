import { useEffect, useRef, useState } from "react";
import { Eye, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { api, Notice, Busy, date } from "../shared/ui";
import { useStudioPane } from "../../modules/studio-navigation/pane";
import { useNavigationReady } from "../../modules/navigation-performance/use-navigation-ready";
import { clientCaught } from "../../modules/log/client";

interface VisitSummary {
  visits: number;
  visitors: number;
}
interface VisitorRow {
  ip: string | null;
  views: number;
  lastTs: number;
  country: string | null;
}
interface VisitorsPage {
  items: VisitorRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 本期只有「网站状态」；横向 tab 预留扩展位，后续数据视图按序追加。
const tabs = [{ id: "site", label: "网站状态" }] as const;
type TabId = (typeof tabs)[number]["id"];

/** 工作台「数据」面板：访问数据全站唯一展示处，访客不可见。 */
export default function DataStudio() {
  const { active } = useStudioPane();
  const activation = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [tab, setTab] = useState<TabId>("site");
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [visitors, setVisitors] = useState<VisitorsPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useNavigationReady("/studio/data", !loading, !!error);

  useEffect(() => {
    if (!active) return;
    const epoch = ++activation.current;
    setLoading(true);
    setError("");
    Promise.all([
      api<VisitSummary>("/api/views/summary"),
      api<VisitorsPage>(`/api/views/visitors?page=${page}`),
    ])
      .then(([s, v]) => {
        if (activeRef.current && activation.current === epoch) {
          setSummary(s);
          setVisitors(v);
        }
      })
      .catch((e) => {
        clientCaught("datastudio.load_failed", e);
        if (activeRef.current && activation.current === epoch)
          setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (activeRef.current && activation.current === epoch)
          setLoading(false);
      });
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
