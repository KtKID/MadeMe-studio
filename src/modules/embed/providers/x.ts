import { DEFAULT_CONFIG } from "../../config/defaults.ts";
import type { EmbedProvider } from "../types.ts";

/** /用户名/status/数字，可带 /photo/1、/video/1 后缀；用户名最多 15 位。 */
const STATUS_PATH =
  /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,20})(?:\/(?:photo|video)\/\d{1,2})?\/?$/;
/** 没有用户名的形式：/i/web/status/数字、/i/status/数字。 */
const WEB_STATUS_PATH = /^\/i\/(?:web\/)?status\/(\d{1,20})\/?$/;

/**
 * X / Twitter 动态。用官方静态嵌入页 platform.twitter.com/embed/Tweet.html（widgets.js
 * 内部也是加载它），iframe 内的脚本运行在 X 自己的源里，文章页不加载任何第三方脚本，
 * CSP 只需把 https://platform.twitter.com 加进 frame-src。高度由 autoHeight.ts 按 X 的
 * postMessage 调整；阅读页始终在 iframe 下方保留“在 X 查看”链接作为降级。
 */
export const x: EmbedProvider = {
  id: "x",
  name: "X",
  hostnames: [
    "x.com",
    "www.x.com",
    "mobile.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
  ],
  kind: "iframe",
  content: "post",
  frameOrigins: ["https://platform.twitter.com"],
  frame: {
    title: "X 动态",
    allow: "",
    // 动态里的链接需要新窗口；不给 allow-top-navigation，无法劫持文章页。
    sandbox:
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    referrerPolicy: "strict-origin-when-cross-origin",
    // 默认初始高度；阅读页按设置页“X 动态初始高度”覆盖。
    initialHeight: DEFAULT_CONFIG.reading.xInitialHeight,
  },
  linkLabel: "在 X 查看",
  parse(u) {
    const web = WEB_STATUS_PATH.exec(u.pathname);
    if (web) return { id: web[1] };
    const m = STATUS_PATH.exec(u.pathname);
    if (!m) return { reason: "invalid_path" };
    return { id: m[2], handle: m[1] };
  },
  playerUrl: ({ id }) =>
    `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true`,
  canonicalUrl: ({ id, handle }) =>
    handle
      ? `https://x.com/${handle}/status/${id}`
      : `https://x.com/i/web/status/${id}`,
};
