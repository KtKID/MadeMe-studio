import type { EmbedProvider } from "../types.ts";
import { parseStartSeconds } from "./time.ts";

/** BV 号：固定 "BV1" + 9 位 base58 字符（不含 0、I、O、l）。 */
const BVID = /^BV1[1-9A-HJ-NP-Za-km-z]{9}$/;
/** av 号：纯数字。 */
const AID = /^\d{1,12}$/;
const VIDEO_PATH = /^\/video\/([^/]+)\/?$/;

/**
 * Bilibili 外链播放器：https://player.bilibili.com/ 。
 * 参数：bvid 或 aid、p（分P，从 1 开始）、t（秒）、autoplay=0 关闭自动播放、
 * isOutside=true 表示站外嵌入。未登录时外链播放器通常只有 360p，high_quality 意义不大，不传。
 * 弹幕保持 Bilibili 默认；如需关闭可在此追加 danmaku=0。
 */
export const bilibili: EmbedProvider = {
  id: "bilibili",
  name: "Bilibili",
  hostnames: [
    "www.bilibili.com",
    "bilibili.com",
    "m.bilibili.com",
    "player.bilibili.com",
  ],
  // b23.tv 短链需要请求一次跳转才能拿到 BV 号；渲染与校验期间绝不发起网络请求。
  shortLinkHosts: ["b23.tv", "www.b23.tv", "b23.wtf"],
  kind: "iframe",
  content: "video",
  frameOrigins: ["https://player.bilibili.com"],
  frame: {
    title: "Bilibili 视频",
    allow: "fullscreen; picture-in-picture; encrypted-media",
    // 播放器内“去 B 站观看”需要新窗口；不给 allow-top-navigation，避免劫持文章页。
    sandbox:
      "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox",
    referrerPolicy: "strict-origin-when-cross-origin",
    aspectRatio: "16 / 9",
  },
  parse(u) {
    let raw: string | null | undefined;
    if (u.hostname === "player.bilibili.com") {
      if (u.pathname !== "/player.html") return { reason: "invalid_path" };
      const bvid = u.searchParams.get("bvid");
      const aid = u.searchParams.get("aid");
      raw = bvid ?? (aid !== null ? `av${aid}` : null);
    } else {
      raw = VIDEO_PATH.exec(u.pathname)?.[1];
    }
    if (!raw) return { reason: "invalid_path" };
    const av = /^av(.+)$/i.exec(raw);
    if (av ? !AID.test(av[1]) : !BVID.test(raw))
      return { reason: "invalid_id" };
    const id = av ? `av${av[1]}` : raw;
    const pageValue = u.searchParams.get("p") ?? u.searchParams.get("page");
    const part =
      pageValue && /^\d{1,3}$/.test(pageValue) && Number(pageValue) >= 1
        ? Number(pageValue)
        : undefined;
    const start = parseStartSeconds(u.searchParams.get("t"));
    return {
      id,
      ...(part && part > 1 ? { part } : {}),
      ...(start ? { start } : {}),
    };
  },
  playerUrl({ id, part, start }) {
    const q = new URLSearchParams({ isOutside: "true" });
    if (id.startsWith("av")) q.set("aid", id.slice(2));
    else q.set("bvid", id);
    q.set("p", String(part ?? 1));
    if (start) q.set("t", String(start));
    q.set("autoplay", "0");
    return `https://player.bilibili.com/player.html?${q}`;
  },
  canonicalUrl({ id, part, start }) {
    const q = new URLSearchParams();
    if (part) q.set("p", String(part));
    if (start) q.set("t", String(start));
    const query = q.toString();
    return `https://www.bilibili.com/video/${id}/${query ? `?${query}` : ""}`;
  },
};
