import { clientCaught } from "../log/client";
import { begin, finish, restore, route, type StudioRoute } from "./protocol";
const KEY = "mademe.navigation-performance.v1";
const now = () => performance.timeOrigin + performance.now();
let enabled = false;
let state = restore(null);
let started = false;
let sequence = 0;
let managedHistory = false;
export function manageHistoryPerformance(value: boolean) {
  managedHistory = value;
}
export function cancelNavigationPerformance() {
  if (enabled) {
    sequence++;
    settle("canceled");
  }
}
export function beginHistoryPerformance(from: StudioRoute, to: StudioRoute) {
  if (!enabled) return;
  sequence++;
  begin(state, from, to, now(), "history");
  publish();
}

function publish() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch (error) {
    // 存储不可用仍保留本页样本。
    clientCaught("perf.storage_write_failed", error, {}, "debug");
  }
  const output = document.getElementById("navigation-performance-json");
  if (output) output.textContent = JSON.stringify(state, null, 2);
}
function settle(status: "ready" | "failed" | "canceled" | "timeout") {
  finish(state, status, now());
  publish();
}
function mount() {
  if (!enabled || document.getElementById("navigation-performance")) return;
  const panel = document.createElement("details");
  panel.id = "navigation-performance";
  panel.open = true;
  panel.style.cssText =
    "position:fixed;bottom:8px;right:8px;z-index:9999;max-width:460px;max-height:35vh;overflow:auto;background:#181818;color:#fff;padding:12px;font:12px monospace";
  const summary = document.createElement("summary");
  summary.textContent = "导航性能诊断（本地，不外传）";
  const pre = document.createElement("pre");
  pre.id = "navigation-performance-json";
  const button = document.createElement("button");
  button.textContent = "导出 JSON";
  button.type = "button";
  button.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "navigation-performance.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  panel.appendChild(summary);
  panel.appendChild(button);
  panel.appendChild(pre);
  document.body.appendChild(panel);
  publish();
}
function expire() {
  const last = state.samples.at(-1);
  if (last?.status === "pending" && now() - last.startedAt >= 30000)
    settle("timeout");
}
/** 仅 React 已提交主要数据、完成 hydration 后调用；双帧把绘制包含在测量内。 */
export function markReady(path: StudioRoute, failed = false) {
  if (!enabled) return;
  const id = state.samples.at(-1)?.id;
  const epoch = sequence;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (epoch !== sequence || route(location.pathname) !== path) return;
      const last = state.samples.at(-1);
      if (
        last &&
        last.id === id &&
        last.to === path &&
        last.status === "pending"
      ) {
        settle(failed ? "failed" : "ready");
        if (!failed) observeVisibleImages(last.id, epoch);
      }
    }),
  );
}
export function installPerformance() {
  if (started) return;
  started = true;
  enabled = new URLSearchParams(location.search).get("perf") === "1";
  if (!enabled) return;
  try {
    state = restore(sessionStorage.getItem(KEY));
  } catch (error) {
    clientCaught("perf.storage_read_failed", error, {}, "debug");
    state = restore(null);
  }
  expire();
  const current = route(location.pathname);
  if (current && state.samples.at(-1)?.status !== "pending")
    begin(state, current, current, performance.timeOrigin, "initial");
  mount();
  window.addEventListener(
    "click",
    (event) => {
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
          ? event.target.closest<HTMLAnchorElement>(".studio-nav a[href]")
          : null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      const to = route(url.pathname);
      const from = route(location.pathname);
      if (!to || !from || url.origin !== location.origin) return;
      // 只传播诊断开关，绝不携带正文或查询输入。
      url.searchParams.set("perf", "1");
      link.href = url.href;
      sequence++;
      const id = begin(state, from, to, now(), "click");
      publish();
      let bubbled = false;
      const bubble = () => {
        bubbled = true;
      };
      window.addEventListener("click", bubble, { once: true });
      setTimeout(() => {
        window.removeEventListener("click", bubble);
        if (state.samples.at(-1)?.id !== id) return;
        // 离开保护会阻止传播；路由器正常接管的 preventDefault 不算取消。
        if (event.defaultPrevented && !bubbled) settle("canceled");
        else if (to === from) settle("canceled");
      }, 0);
    },
    true,
  );
  document.addEventListener("astro:before-swap", () => {
    sequence++;
  });
  document.addEventListener("astro:page-load", mount);
  window.addEventListener("popstate", () => {
    if (managedHistory) return;
    const to = route(location.pathname);
    const from = state.samples.at(-1)?.to;
    if (to && from) {
      sequence++;
      begin(state, from, to, now(), "history");
      publish();
    }
  });
  window.addEventListener("pageshow", (event) => {
    mount();
    if (!managedHistory && event.persisted && current) markReady(current);
  });
  setInterval(expire, 500);
}

/** 只观察首次内容可交互时视口内的主区图片；不触发滚动或改变 lazy loading。 */
function observeVisibleImages(id: number, epoch: number) {
  const sample = state.samples.find((s) => s.id === id);
  if (!sample) return;
  const images = Array.from(
    document.querySelectorAll<HTMLImageElement>("#main img"),
  ).filter((image) => {
    const rect = image.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  });
  sample.visibleImages = { count: images.length, status: "pending" };
  const poll = () => {
    if (!sample.visibleImages) return true;
    let status: "ready" | "failed" | "timeout" | "superseded" | undefined;
    if (sequence !== epoch) status = "superseded";
    else if (images.some((image) => image.complete && image.naturalWidth === 0))
      status = "failed";
    else if (images.every((image) => image.complete && image.naturalWidth > 0))
      status = "ready";
    else if (now() - sample.startedAt >= 30000) status = "timeout";
    if (!status) return false;
    sample.visibleImages = {
      count: images.length,
      status,
      durationMs: Math.max(0, now() - sample.startedAt),
    };
    publish();
    return true;
  };
  publish();
  if (!poll()) {
    const timer = setInterval(() => {
      if (poll()) clearInterval(timer);
    }, 25);
  }
}
