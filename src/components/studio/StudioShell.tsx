import { clientCaught } from "../../modules/log/client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  Feather,
  FileText,
  Image,
  Settings as SettingsIcon,
  Cable,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import type { StudioPageData } from "../../server/page-data";
import type { Settings } from "../../shared/contracts";
import {
  route,
  type StudioRoute,
} from "../../modules/navigation-performance/protocol";
import {
  installPerformance,
  manageHistoryPerformance,
  beginHistoryPerformance,
  cancelNavigationPerformance,
} from "../../modules/navigation-performance/browser";
import {
  StudioHistory,
  sameIdentity,
  studioHistorySchema,
} from "../../modules/studio-navigation/state";
import { StudioPaneContext } from "../../modules/studio-navigation/pane";
import Dashboard from "../content/Dashboard";
import MediaLibrary from "../media/MediaLibrary";
import SettingsPanel from "../settings/SettingsPanel";
import Integrations from "../integrations/Integrations";
import { Notice } from "../shared/ui";
const links = [
  { href: "/studio", label: "所有文章", icon: FileText },
  { href: "/studio/media", label: "媒体库", icon: Image },
  { href: "/studio/settings", label: "站点设置", icon: SettingsIcon },
  { href: "/studio/integrations", label: "连接与发布", icon: Cable },
] as const;
type Guard = { dirty: boolean; discard: () => void };
/** 四个业务模块自持数据；外壳只协调导航、离开保护与身份生命周期。 */
export default function StudioShell({
  initial,
  initialPath,
  passwordAuth = false,
}: {
  initial: StudioPageData;
  initialPath: StudioRoute;
  passwordAuth?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(initialPath);
  const [navigationKey, setNavigationKey] = useState(0);
  const [settings, setSettings] = useState(initial.settings);
  const [visible, setVisible] = useState(true);
  const [valid, setValid] = useState(initial.capabilities.authenticated);
  const privateRoot = useRef<HTMLDivElement>(null);
  const activeRef = useRef(initialPath);
  const guard = useRef<Guard>({ dirty: false, discard: () => {} });
  const historyRef = useRef<StudioHistory | null>(null);
  const invalidated = useRef(!initial.capabilities.authenticated);
  const visibilityEpoch = useRef(0);
  const allowUnload = useRef(false);
  const onGuardChange = useCallback((next: Guard) => {
    if (!invalidated.current) guard.current = next;
  }, []);
  const onSaved = useCallback((next: Settings) => setSettings(next), []);
  const title = links.find((item) => item.href === active)!.label;
  function allowLeave() {
    if (activeRef.current !== "/studio/settings" || !guard.current.dirty)
      return true;
    if (!window.confirm("设置尚未保存，确定离开吗？")) return false;
    guard.current.discard();
    guard.current.dirty = false;
    return true;
  }
  function activate(next: StudioRoute) {
    activeRef.current = next;
    setActive(next);
    setNavigationKey((key) => key + 1);
  }
  useEffect(() => {
    installPerformance();
    manageHistoryPerformance(true);
    setHydrated(true);
    const history = new StudioHistory(crypto.randomUUID());
    historyRef.current = history;
    window.history.replaceState(
      { ...window.history.state, studio: history.entry() },
      "",
      location.href,
    );
    const pop = (event: PopStateEvent) => {
      const next = route(location.pathname);
      const parsed = studioHistorySchema.safeParse(event.state?.studio);
      if (!next || !parsed.success || parsed.data.session !== history.session) {
        // 不接管其他document/未知历史，交回正常SSR与浏览器离开保护。
        location.reload();
        return;
      }
      if (history.locked) {
        const result = history.pop(parsed.data, false);
        if (result.kind === "restore") window.history.go(result.delta);
        return;
      }
      beginHistoryPerformance(activeRef.current, next);
      const accepted = next === activeRef.current || allowLeave();
      const result = history.pop(parsed.data, accepted);
      if (result.kind === "restore") {
        cancelNavigationPerformance();
        window.history.go(result.delta);
        return;
      }
      activate(next);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowUnload.current) {
        allowUnload.current = false;
        return;
      }
      if (guard.current.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      manageHistoryPerformance(false);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  useEffect(() => {
    // 同步遮蔽DOM，早于下一次React提交；不在blur时处理，避免文件选择/确认框误触。
    const conceal = () => {
      cancelNavigationPerformance();
      visibilityEpoch.current++;
      if (privateRoot.current) privateRoot.current.hidden = true;
      setVisible(false);
      window.dispatchEvent(new Event("mademe:private-conceal"));
    };
    const invalidate = () => {
      invalidated.current = true;
      conceal();
      setValid(false);
      guard.current = { dirty: false, discard: () => {} };
    };
    const resume = async () => {
      if (document.visibilityState === "hidden" || invalidated.current) return;
      conceal();
      const epoch = visibilityEpoch.current;
      try {
        const response = await fetch("/api/identity", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await response.json();
        if (epoch !== visibilityEpoch.current || invalidated.current) return;
        if (!response.ok || !sameIdentity(initial.trustedIdentity, data)) {
          invalidate();
          return;
        }
        if (privateRoot.current) privateRoot.current.hidden = false;
        setVisible(true);
        setNavigationKey((key) => key + 1);
      } catch (error) {
        clientCaught("studio.identity_recheck_failed", error);
        if (epoch === visibilityEpoch.current) invalidate();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
      else void resume();
    };
    const pageshow = (event: PageTransitionEvent) => {
      allowUnload.current = false;
      if (event.persisted) void resume();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("mademe:identity-invalid", invalidate);
    return () => {
      visibilityEpoch.current++;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("mademe:identity-invalid", invalidate);
    };
  }, [initial.trustedIdentity]);
  useEffect(() => {
    document.title = `${title} · ${settings.siteTitle || "MadeMe"}`;
    if (navigationKey && visible && valid) {
      const heading = privateRoot.current?.querySelector<HTMLElement>(
        ".studio-pane:not([hidden]) h1",
      );
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }, [title, settings.siteTitle, navigationKey, visible, valid]);
  function navigate(event: MouseEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (
      !link ||
      (link.target && link.target !== "_self") ||
      link.hasAttribute("download")
    )
      return;
    const url = new URL(link.href, location.href);
    if (!["https:", "http:"].includes(url.protocol)) return;
    const next = url.origin === location.origin ? route(url.pathname) : null;
    if (next) {
      event.preventDefault();
      if (historyRef.current?.locked || !valid || !visible) {
        cancelNavigationPerformance();
        return;
      }
      if (next !== activeRef.current && !allowLeave()) {
        event.stopPropagation();
        cancelNavigationPerformance();
        return;
      }
      if (new URLSearchParams(location.search).get("perf") === "1")
        url.searchParams.set("perf", "1");
      if (url.href === location.href) {
        cancelNavigationPerformance();
        return;
      }
      window.history.pushState({ studio: historyRef.current!.push() }, "", url);
      activate(next);
      window.scrollTo(0, 0);
    } else if (url.href !== location.href) {
      if (!allowLeave()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      allowUnload.current = true;
    }
  }
  const panes = valid
    ? [
        <>
          <Dashboard
            initial={{ ...initial, settings }}
            initialError={initial.postsError}
          />
        </>,
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">A LITTLE MORE THAN WORDS</div>
              <h1>给灵感，留个画面。</h1>
              <p>图片、声音与片段，都可以成为故事的一部分。</p>
            </div>
          </div>
          <section className="content-panel media-panel">
            <MediaLibrary
              initialMedia={initial.initialMedia}
              initialError={initial.mediaError}
              imageConfigured={settings.providers.some(
                (provider) => provider.imageConfigured,
              )}
              providers={settings.providers}
            />
          </section>
        </>,
        <SettingsPanel
          initial={initial.settings}
          authenticated
          onGuardChange={onGuardChange}
          onSaved={onSaved}
        />,
        <Integrations
          authenticated
          initialTokens={initial.initialTokens}
          initialError={initial.tokensError}
        />,
      ]
    : [];
  return (
    <div
      className="studio-shell"
      data-studio-ready={hydrated ? "true" : undefined}
      onClickCapture={navigate}
    >
      <aside className="studio-sidebar">
        <a className="brand" href="/studio">
          <span className="brand-icon">
            <Feather size={22} />
          </span>
          <span>
            {settings.siteTitle || "MadeMe"}
            <small>YOUR PERSONAL STUDIO</small>
          </span>
        </a>
        <a href="/studio/new" className="button primary new-post">
          <Plus size={17} />
          写新文章
        </a>
        <div className="nav-label">工作空间</div>
        <nav className="studio-nav" aria-label="创作后台">
          {links.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={active === item.href ? "active" : undefined}
              aria-current={active === item.href ? "page" : undefined}
            >
              <item.icon size={18} />
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a className="site-link" href="/" target="_blank" rel="noreferrer">
            <span className="site-avatar">M</span>
            <span>
              我的站点<small>看看发布后的样子</small>
            </span>
            <ArrowUpRight size={16} />
          </a>
          {passwordAuth && (
            <a
              className="site-link"
              href={`/login?returnTo=${encodeURIComponent(active)}`}
            >
              作者登录 / 账号与退出
            </a>
          )}
          <div className="sidebar-note">
            <span className="status-dot" />
            写作，让想法有迹可循
          </div>
        </div>
      </aside>
      <div className="studio-body">
        <header className="studio-topbar">
          <span className="breadcrumb">
            工作空间 <span>/</span> <strong>{title}</strong>
          </span>
          <a className="topbar-site" href="/">
            访问站点 <ArrowUpRight size={14} />
          </a>
        </header>
        <main id="main" className="studio-main">
          {!valid && (
            <Notice>需要重新验证作者身份，请刷新页面或登录后继续。</Notice>
          )}
          {valid && !visible && <Notice>正在重新验证作者身份…</Notice>}
          <div ref={privateRoot} hidden={!visible || !valid}>
            {panes.map((pane, index) => (
              <StudioPaneContext.Provider
                key={links[index]!.href}
                value={{
                  active: visible && active === links[index]!.href,
                  navigationKey,
                }}
              >
                <div
                  className="studio-pane"
                  hidden={active !== links[index]!.href}
                  inert={active !== links[index]!.href}
                >
                  {pane}
                </div>
              </StudioPaneContext.Provider>
            ))}
          </div>
        </main>
        <footer className="studio-footer">
          Made with intention. <span>Powered by MadeMe</span>
        </footer>
      </div>
    </div>
  );
}
