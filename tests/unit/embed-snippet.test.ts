import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_EMBED_INPUT_LENGTH,
  parseEmbedInput,
  readResizeMessage,
} from "../../src/modules/embed";

// 用户实际粘贴的 X 官方嵌入代码（blockquote + widgets.js）。
const xSnippet = readFileSync("tests/fixtures/x-embed-snippet.html", "utf8");

function okUrl(input: string) {
  const r = parseEmbedInput(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r;
}

describe("从官方嵌入代码中识别链接", () => {
  it("X blockquote：取出动态链接并去掉 ref_src，忽略 widgets.js 与 t.co", () => {
    const r = okUrl(xSnippet);
    expect(r.fromSnippet).toBe(true);
    expect(r.match.provider.id).toBe("x");
    expect(r.match.canonicalUrl).toBe(
      "https://x.com/op7418/status/2115000078104691168",
    );
  });
  it("twitter.com 旧版嵌入代码与单引号属性", () => {
    const r = okUrl(
      "<blockquote class='twitter-tweet'><a href='https://twitter.com/jack/status/20?ref_src=twsrc%5Etfw'>March 21, 2006</a></blockquote>",
    );
    expect(r.match.canonicalUrl).toBe("https://x.com/jack/status/20");
  });
  it("YouTube iframe 代码 → 规范 watch 链接（保留起始时间）", () => {
    const r = okUrl(
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc&amp;start=42" title="YouTube video player" frameborder="0" allowfullscreen></iframe>',
    );
    expect(r.match.provider.id).toBe("youtube");
    expect(r.match.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    );
  });
  it("Bilibili iframe 代码：协议相对地址、&amp; 实体、分P", () => {
    const r = okUrl(
      '<iframe src="//player.bilibili.com/player.html?isOutside=true&amp;aid=113&amp;bvid=BV1KW4y1j7AF&amp;cid=25&amp;p=2" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>',
    );
    expect(r.match.provider.id).toBe("bilibili");
    expect(r.match.canonicalUrl).toBe(
      "https://www.bilibili.com/video/BV1KW4y1j7AF/?p=2",
    );
  });
  it("普通链接原样交给 parseEmbed，不标记为嵌入代码", () => {
    const r = okUrl("  https://x.com/i/web/status/123  ");
    expect(r.fromSnippet).toBe(false);
  });
  it.each([
    [
      '<script async src="https://platform.x.com/widgets.js"></script>',
      "snippet_without_link",
    ],
    ['<a href="javascript:alert(1)">x</a>', "snippet_without_link"],
    [
      '<iframe src="https://player.bilibili.com.evil.com/player.html?bvid=BV1KW4y1j7AF"></iframe>',
      "snippet_without_link",
    ],
    [
      '<iframe src="http://www.youtube.com/embed/dQw4w9WgXcQ">',
      "snippet_without_link",
    ],
    ["<p>随便一段 HTML</p>", "snippet_without_link"],
    [
      `<a href="https://x.com/a/status/1">${"x".repeat(MAX_EMBED_INPUT_LENGTH)}</a>`,
      "too_long",
    ],
  ])("拒绝：%s", (input, reason) => {
    const r = parseEmbedInput(input);
    expect(r.ok).toBe(false);
    expect(r.fromSnippet).toBe(true);
    if (!r.ok) expect(r.reason).toBe(reason);
  });
  it("非字符串", () => {
    expect(parseEmbedInput(42)).toMatchObject({
      ok: false,
      reason: "not_string",
    });
  });
});

describe("X 嵌入页的高度消息", () => {
  const resize = (height: unknown) => ({
    "twttr.embed": {
      jsonrpc: "2.0",
      method: "twttr.private.resize",
      params: [{ width: 550, height }],
    },
  });
  it("对象与 JSON 字符串两种形式都接受，并限制在 80–4000px", () => {
    expect(readResizeMessage(resize(783))).toBe(783);
    expect(readResizeMessage(JSON.stringify(resize(224.4)))).toBe(225);
    expect(readResizeMessage(resize(10))).toBe(80);
    expect(readResizeMessage(resize(99999))).toBe(4000);
  });
  it("其他消息一律忽略", () => {
    expect(readResizeMessage("not json")).toBeNull();
    expect(readResizeMessage(resize("<script>"))).toBeNull();
    expect(
      readResizeMessage({ "twttr.embed": { method: "twttr.private.trigger" } }),
    ).toBeNull();
    expect(readResizeMessage(null)).toBeNull();
  });
});
