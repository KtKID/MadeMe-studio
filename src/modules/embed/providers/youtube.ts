import type { EmbedProvider } from "../types";
import { parseStartSeconds } from "./time";

const ID = /^[\w-]{11}$/;
/** /embed/ID、/shorts/ID、/live/ID、/v/ID 这几种路径的第二段是视频 id。 */
const PATH_ID = /^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/;

export const youtube: EmbedProvider = {
  id: "youtube",
  name: "YouTube",
  hostnames: [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
  ],
  kind: "iframe",
  content: "video",
  frameOrigins: ["https://www.youtube-nocookie.com"],
  frame: {
    title: "YouTube 视频",
    allow:
      "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen",
    sandbox: "allow-scripts allow-same-origin allow-presentation",
    // YouTube 播放器需要来源站点信息，no-referrer 会导致 153 错误。
    referrerPolicy: "strict-origin-when-cross-origin",
    aspectRatio: "16 / 9",
  },
  parse(u) {
    let id: string | null | undefined;
    if (u.hostname === "youtu.be") {
      const m = /^\/([^/]+)\/?$/.exec(u.pathname);
      id = m?.[1];
    } else if (u.pathname === "/watch" || u.pathname === "/watch/") {
      id = u.searchParams.get("v");
    } else {
      id = PATH_ID.exec(u.pathname)?.[1];
    }
    if (!id) return { reason: "invalid_path" };
    if (!ID.test(id)) return { reason: "invalid_id" };
    const start = parseStartSeconds(
      u.searchParams.get("t") ?? u.searchParams.get("start"),
    );
    return start ? { id, start } : { id };
  },
  playerUrl: ({ id, start }) =>
    `https://www.youtube-nocookie.com/embed/${id}` +
    (start ? `?start=${start}` : ""),
  canonicalUrl: ({ id, start }) =>
    `https://www.youtube.com/watch?v=${id}` + (start ? `&t=${start}s` : ""),
};
