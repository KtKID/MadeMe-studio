import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embedFrameOrigins,
  embedProviders,
  embedRejectMessage,
  parseEmbed,
  reportEmbedRejection,
  supportedEmbedLabel,
} from "../../src/modules/embed";
import { parseStartSeconds } from "../../src/modules/embed/providers/time";
import { validateContent } from "../../src/server/content/validation";
import {
  frameSrcDirective,
  secureResponse,
} from "../../src/server/response-policy";

const ok = (url: string) => {
  const r = parseEmbed(url);
  if (!r.ok) throw new Error(`expected ok for ${url}: ${r.reason}`);
  return r.match;
};
const reason = (url: unknown) => {
  const r = parseEmbed(url);
  return r.ok ? "ok" : r.reason;
};
// 用户生产文章 cf-46630d 中的真实链接形态（追踪参数为示例值）。
const userLink =
  "https://www.bilibili.com/video/BV1KW4y1j7AF/?spm_id_from=333.788.recommend_more_video.4&vd_source=abc";

describe("嵌入注册表", () => {
  it("每个提供方配置完整，iframe 类有播放器与来源", () => {
    expect(embedProviders.map((p) => p.id)).toEqual([
      "youtube",
      "bilibili",
      "x",
    ]);
    for (const p of embedProviders) {
      expect(p.name).toBeTruthy();
      expect(p.hostnames.length).toBeGreaterThan(0);
      expect(["video", "post"]).toContain(p.content);
      if (p.kind === "iframe") {
        // 固定比例的播放器给 aspectRatio，高度随内容变化的动态给 initialHeight。
        expect(p.frame?.aspectRatio || p.frame?.initialHeight).toBeTruthy();
        expect(p.playerUrl).toBeTypeOf("function");
        expect(p.frameOrigins.every((o) => o.startsWith("https://"))).toBe(
          true,
        );
      } else expect(p.frameOrigins).toEqual([]);
    }
    expect(embedFrameOrigins()).toEqual([
      "https://platform.twitter.com",
      "https://player.bilibili.com",
      "https://www.youtube-nocookie.com",
    ]);
    expect(supportedEmbedLabel()).toBe("YouTube、Bilibili 视频与 X 动态");
  });
});

describe("Bilibili", () => {
  it("用户文章里的 BV 链接（带追踪参数）→ 外链播放器", () => {
    const m = ok(userLink);
    expect(m.provider.id).toBe("bilibili");
    expect(m.target).toEqual({ id: "BV1KW4y1j7AF" });
    expect(m.playerUrl).toBe(
      "https://player.bilibili.com/player.html?isOutside=true&bvid=BV1KW4y1j7AF&p=1&autoplay=0",
    );
    expect(m.playerUrl).not.toContain("vd_source");
  });
  it("支持 bilibili.com / m.bilibili.com / 分P / 起始时间 / av 号 / 播放器地址", () => {
    expect(ok("https://bilibili.com/video/BV1KW4y1j7AF").target.id).toBe(
      "BV1KW4y1j7AF",
    );
    expect(ok("https://m.bilibili.com/video/BV1KW4y1j7AF").provider.id).toBe(
      "bilibili",
    );
    expect(
      ok("https://www.bilibili.com/video/BV1KW4y1j7AF/?p=3&t=90").playerUrl,
    ).toBe(
      "https://player.bilibili.com/player.html?isOutside=true&bvid=BV1KW4y1j7AF&p=3&t=90&autoplay=0",
    );
    expect(ok("https://www.bilibili.com/video/av170001").playerUrl).toContain(
      "aid=170001",
    );
    expect(
      ok("https://player.bilibili.com/player.html?bvid=BV1KW4y1j7AF&p=2")
        .target,
    ).toEqual({ id: "BV1KW4y1j7AF", part: 2 });
  });
  it("无效分P / 时间被忽略而不是拼进播放器地址", () => {
    const m = ok("https://www.bilibili.com/video/BV1KW4y1j7AF?p=0&t=abc");
    expect(m.target).toEqual({ id: "BV1KW4y1j7AF" });
    expect(
      ok('https://www.bilibili.com/video/BV1KW4y1j7AF?p="><script>').playerUrl,
    ).not.toContain("script");
  });
  it("拒绝畸形 BV 号、其他路径与短链", () => {
    expect(reason("https://www.bilibili.com/video/BV1KW4y1j7A")).toBe(
      "invalid_id",
    );
    expect(reason("https://www.bilibili.com/video/BV1KW4y1j7A0")).toBe(
      "invalid_id",
    );
    expect(reason("https://www.bilibili.com/video/BV1KW4y1j7AF%22onload")).toBe(
      "invalid_id",
    );
    expect(reason("https://www.bilibili.com/video/avx1")).toBe("invalid_id");
    expect(reason("https://www.bilibili.com/bangumi/play/ep1")).toBe(
      "invalid_path",
    );
    expect(reason("https://www.bilibili.com/video/BV1KW4y1j7AF/extra")).toBe(
      "invalid_path",
    );
    expect(
      reason("https://player.bilibili.com/other.html?bvid=BV1KW4y1j7AF"),
    ).toBe("invalid_path");
    expect(reason("https://b23.tv/abc123")).toBe("short_link_unsupported");
    expect(embedRejectMessage("short_link_unsupported")).toContain("b23.tv");
  });
});

describe("YouTube（迁移自旧实现）", () => {
  it("常见形态与起始时间", () => {
    expect(ok("https://youtu.be/dQw4w9WgXcQ").playerUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(
      ok("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s").playerUrl,
    ).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
    for (const u of [
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ])
      expect(ok(u).target.id).toBe("dQw4w9WgXcQ");
  });
  it("拒绝非法 id 与非视频路径", () => {
    expect(reason("https://www.youtube.com/watch?v=short")).toBe("invalid_id");
    expect(reason("https://www.youtube.com/channel/UC123")).toBe(
      "invalid_path",
    );
  });
});

describe("X 动态", () => {
  it("x.com / twitter.com 动态 → 官方静态嵌入页，规范链接去掉追踪参数", () => {
    const m = ok(
      "https://x.com/op7418/status/2115000078104691168?ref_src=twsrc%5Etfw",
    );
    expect(m.provider.kind).toBe("iframe");
    expect(m.provider.content).toBe("post");
    expect(m.target).toEqual({ id: "2115000078104691168", handle: "op7418" });
    expect(m.playerUrl).toBe(
      "https://platform.twitter.com/embed/Tweet.html?id=2115000078104691168&dnt=true",
    );
    expect(m.canonicalUrl).toBe(
      "https://x.com/op7418/status/2115000078104691168",
    );
    expect(ok("https://twitter.com/jack/status/20").target.id).toBe("20");
    expect(ok("https://mobile.twitter.com/jack/status/20/").target.id).toBe(
      "20",
    );
    expect(ok("https://x.com/jack/status/20/photo/1").target.id).toBe("20");
  });
  it("接受没有用户名的 /i/web/status/ 与 /i/status/", () => {
    for (const u of [
      "https://x.com/i/web/status/2115000078104691168",
      "https://twitter.com/i/status/2115000078104691168",
    ]) {
      const m = ok(u);
      expect(m.target).toEqual({ id: "2115000078104691168" });
      expect(m.canonicalUrl).toBe(
        "https://x.com/i/web/status/2115000078104691168",
      );
    }
  });
  it("拒绝非动态路径与畸形 id", () => {
    expect(reason("https://x.com/example")).toBe("invalid_path");
    expect(reason("https://x.com/example/status/abc")).toBe("invalid_path");
    expect(reason("https://x.com/a/status/123456789012345678901")).toBe(
      "invalid_path",
    );
    expect(reason("https://platform.x.com/widgets.js")).toBe(
      "unsupported_host",
    );
  });
});

describe("恶意与畸形链接", () => {
  it.each([
    ["https://bilibili.com.evil.com/video/BV1KW4y1j7AF", "unsupported_host"],
    ["https://evilbilibili.com/video/BV1KW4y1j7AF", "unsupported_host"],
    ["https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "unsupported_host"],
    ["javascript:alert(1)", "not_https"],
    ["data:text/html,<script>", "not_https"],
    ["http://www.bilibili.com/video/BV1KW4y1j7AF", "not_https"],
    ["//www.bilibili.com/video/BV1KW4y1j7AF", "invalid_url"],
    ["/video/BV1KW4y1j7AF", "invalid_url"],
    ["https://user:pw@www.bilibili.com/video/BV1KW4y1j7AF", "credentials"],
    ["https://www.bilibili.com:8443/video/BV1KW4y1j7AF", "port"],
    ["", "invalid_url"],
  ])("%s → %s", (url, expected) => {
    expect(reason(url)).toBe(expected);
  });
  it("非字符串", () => {
    expect(reason(undefined)).toBe("not_string");
    expect(reason({ toString: () => userLink })).toBe("not_string");
  });
});

describe("起始时间解析", () => {
  it.each([
    ["90", 90],
    ["90s", 90],
    ["12.5", 12],
    ["1m30s", 90],
    ["1h2m3s", 3723],
    ["0", undefined],
    ["abc", undefined],
    ["99999999", undefined],
    [null, undefined],
  ])("%s → %s", (value, expected) => {
    expect(parseStartSeconds(value as string | null)).toBe(expected);
  });
});

describe("服务端校验与日志", () => {
  afterEach(() => vi.restoreAllMocks());
  it("embed 块接受 Bilibili，拒绝时只记录 reason 与主机名", () => {
    expect(() =>
      validateContent([{ type: "embed", props: { url: userLink } }] as never),
    ).not.toThrow();
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() =>
      validateContent([
        {
          type: "embed",
          props: { url: "https://bilibili.com.evil.com/video/x?token=secret" },
        },
      ] as never),
    ).toThrow(/Bilibili/);
    const line = String(info.mock.calls[0]?.[0]);
    const record = JSON.parse(line);
    expect(record).toMatchObject({
      level: "info",
      event: "embed.rejected",
      where: "server_validation",
      reason: "unsupported_host",
      host: "bilibili.com.evil.com",
    });
    expect(line).not.toContain("token");
    expect(line).not.toContain("/video/");
  });
  it("成功结果不记录", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    reportEmbedRejection("reader", parseEmbed(userLink));
    expect(info).not.toHaveBeenCalled();
  });
});

describe("CSP frame-src 来自注册表", () => {
  it("HTML 响应只允许本站与登记的播放器来源", () => {
    expect(frameSrcDirective).toBe(
      "frame-src 'self' https://platform.twitter.com https://player.bilibili.com https://www.youtube-nocookie.com",
    );
    for (const path of ["/p/cf-46630d", "/studio", "/login"]) {
      const csp = secureResponse(
        new Response("", { headers: { "Content-Type": "text/html" } }),
        new URL("https://example.com" + path),
        "google",
      ).headers.get("Content-Security-Policy")!;
      expect(csp.startsWith(frameSrcDirective + ";")).toBe(true);
      expect(csp).toContain("object-src 'none'");
    }
  });
});
