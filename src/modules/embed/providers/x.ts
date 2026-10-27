import type { EmbedProvider } from "../types";

const STATUS_PATH = /^\/([a-zA-Z0-9_]+)\/status\/(\d{1,20})\/?$/;

/** X 不加载第三方脚本，只渲染安全跳转卡片，因此没有 frameOrigins。 */
export const x: EmbedProvider = {
  id: "x",
  name: "X",
  hostnames: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  kind: "link",
  frameOrigins: [],
  linkLabel: "在 X 上阅读这条动态",
  parse(u) {
    const m = STATUS_PATH.exec(u.pathname);
    if (!m) return { reason: "invalid_path" };
    return { id: m[2] };
  },
};
