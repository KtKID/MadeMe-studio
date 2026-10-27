import { clientLog } from "../log/client";
import { embedProviders } from "./registry";

/** 需要按内容调整高度的提供方来源（目前只有 X：https://platform.twitter.com）。 */
const autoHeightOrigins = new Set(
  embedProviders
    .filter((p) => p.frame?.initialHeight)
    .flatMap((p) => p.frameOrigins),
);
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 4000;
const installed = new WeakSet<Window>();

/**
 * 读取 X 嵌入页发来的 {"twttr.embed": {method: "twttr.private.resize", params: [{height}]}}。
 * 返回高度或 null。只接受数字，其他字段一律忽略。
 */
export function readResizeMessage(data: unknown): number | null {
  let value = data;
  if (typeof value === "string") {
    if (value.length > 10_000) return null;
    try {
      value = JSON.parse(value);
    } catch {
      // 不是 X 的消息（其他脚本也会 postMessage），按“不是 resize”处理。
      return null;
    }
  }
  const call = (value as Record<string, unknown> | null)?.["twttr.embed"] as
    { method?: unknown; params?: unknown } | undefined;
  if (!call || call.method !== "twttr.private.resize") return null;
  const first = Array.isArray(call.params) ? call.params[0] : undefined;
  const height = Number((first as { height?: unknown } | undefined)?.height);
  if (!Number.isFinite(height) || height <= 0) return null;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)));
}

/**
 * 在页面上安装（只装一次）message 监听：来源必须在 autoHeightOrigins 中，且 event.source
 * 必须正是某个 iframe[data-auto-height] 的 contentWindow，才调整该 iframe 的高度。
 *
 * 降级：iframe 触发 load 后 fallbackMs 内仍未收到高度（动态被删、X 不可达），标记为
 * unavailable（CSS 隐藏），只留下方“在 X 查看”链接，并写 embed.frame_unavailable 日志
 * （只含提供方）。iframe 是 loading="lazy"，所以计时从 load 开始，而不是从页面打开开始；
 * 脚本执行前就已加载完的、位于可视区域内的 iframe 由每次调用安排的检查兜底。
 */
export function installEmbedAutoHeight(
  win: Window = window,
  { fallbackMs = 12_000 }: { fallbackMs?: number } = {},
) {
  if (!installed.has(win)) {
    installed.add(win);
    win.addEventListener("message", (event) => onMessage(win, event));
    // load 不冒泡，用捕获阶段监听所有 iframe 的 load。
    win.document.addEventListener(
      "load",
      (event) => {
        const frame = event.target as HTMLElement | null;
        if (
          frame?.tagName === "IFRAME" &&
          frame.hasAttribute("data-auto-height")
        )
          win.setTimeout(
            () => markStalled(frame as HTMLIFrameElement),
            fallbackMs,
          );
      },
      true,
    );
  }
  win.setTimeout(() => {
    for (const frame of win.document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-auto-height]",
    )) {
      const rect = frame.getBoundingClientRect();
      if (rect.top < win.innerHeight && rect.bottom > 0) markStalled(frame);
    }
  }, fallbackMs);
}

function onMessage(win: Window, event: MessageEvent) {
  if (!autoHeightOrigins.has(event.origin)) return;
  const height = readResizeMessage(event.data);
  if (height === null) return;
  for (const frame of win.document.querySelectorAll<HTMLIFrameElement>(
    "iframe[data-auto-height]",
  )) {
    if (frame.contentWindow !== event.source) continue;
    frame.style.height = `${height}px`;
    frame.dataset.embedState = "ready";
  }
}

function markStalled(frame: HTMLIFrameElement) {
  if (frame.dataset.embedState || !frame.isConnected) return;
  frame.dataset.embedState = "unavailable";
  clientLog("info", "embed.frame_unavailable", {
    provider: frame.dataset.provider || "unknown",
  });
}
