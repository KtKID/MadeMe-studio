import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockReader, {
  SafeEmbed,
  videoSource,
} from "../src/components/content/BlockReader";

const userLink =
  "https://www.bilibili.com/video/BV1KW4y1j7AF/?spm_id_from=333.788&vd_source=abc";
const video = (url: string) =>
  renderToStaticMarkup(
    <BlockReader blocks={[{ type: "video", props: { url, name: "" } }]} />,
  );

describe("嵌入渲染（注册表驱动）", () => {
  it("生产文章 cf-46630d 的视频块（Bilibili 链接）渲染为 Bilibili 播放器，无需改数据", () => {
    const html = video(userLink);
    expect(html).not.toContain("<video");
    expect(html).toContain('data-embed="bilibili"');
    expect(html).toContain(
      'src="https://player.bilibili.com/player.html?isOutside=true&amp;bvid=BV1KW4y1j7AF&amp;p=1&amp;autoplay=0"',
    );
    expect(html).toContain('sandbox="allow-scripts allow-same-origin');
    expect(html).not.toContain("allow-top-navigation");
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain("aspect-ratio:16 / 9");
    expect(videoSource(userLink)?.kind).toBe("embed");
  });
  it("embed 块（工具栏“嵌入”）同样接受 Bilibili", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "embed",
            props: { url: "https://m.bilibili.com/video/BV1KW4y1j7AF?p=2" },
          },
        ]}
      />,
    );
    expect(html).toContain("bvid=BV1KW4y1j7AF&amp;p=2");
  });
  it("YouTube 与 X 行为保持不变", () => {
    expect(
      renderToStaticMarkup(<SafeEmbed url="https://youtu.be/dQw4w9WgXcQ" />),
    ).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    const x = renderToStaticMarkup(
      <SafeEmbed url="https://x.com/a/status/1?ref_src=twsrc" />,
    );
    // X 改为官方静态嵌入页 iframe，下方始终保留“在 X 查看”降级链接（规范链接）。
    expect(x).toContain(
      'src="https://platform.twitter.com/embed/Tweet.html?id=1&amp;dnt=true"',
    );
    expect(x).toContain("data-auto-height");
    expect(x).toContain(
      'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
    );
    expect(x).not.toContain("allow-top-navigation");
    expect(x).toContain('href="https://x.com/a/status/1"');
    expect(x).toContain("在 X 查看 @a 的动态");
  });
  it("上传文件与直链仍是 <video>，其他网页仍是跳转卡片", () => {
    expect(video("/api/files/abc")).toContain('<video src="/api/files/abc"');
    expect(video("https://cdn.example.com/a.mp4")).toContain("<video");
    const other = video("https://vimeo.com/123");
    expect(other).toContain("video-link");
    expect(other).not.toContain("<iframe");
  });
  it("恶意主机不会生成 iframe，嵌入块显示支持清单并记录 info", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const html = renderToStaticMarkup(
      <SafeEmbed url="https://bilibili.com.evil.com/video/BV1KW4y1j7AF" />,
    );
    expect(html).not.toContain("<iframe");
    expect(html).toContain("YouTube、Bilibili 视频与 X 动态");
    expect(String(info.mock.calls[0]?.[0])).toContain(
      '"reason":"unsupported_host"',
    );
    info.mockRestore();
  });
  it("silent 预览不写日志", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    renderToStaticMarkup(<SafeEmbed url="https://evil.test/" silent />);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
