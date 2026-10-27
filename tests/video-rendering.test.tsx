import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockReader, {
  videoSource,
} from "../src/components/content/BlockReader";
import { safeUrl } from "../src/components/shared/ui";
import { MAX_MEDIA_BYTES, mediaUploadProblem } from "../src/shared/contracts";

const render = (url: string) =>
  renderToStaticMarkup(
    <BlockReader blocks={[{ type: "video", props: { url, name: "" } }]} />,
  );

describe("视频块渲染（生产文章 cf-46630d 复现）", () => {
  it("空 url 不再被解析为 https://local.invalid/ 占位播放器", () => {
    expect(safeUrl("")).toBeUndefined();
    expect(safeUrl("   ")).toBeUndefined();
    expect(safeUrl("relative-only")).toBeUndefined();
    const html = render("");
    expect(html).not.toContain("<video");
    expect(html).not.toContain("local.invalid");
  });
  it("站内路径和绝对链接保持原有行为", () => {
    expect(safeUrl("/api/files/abc")).toBe("/api/files/abc");
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
  });
  it("站内上传的视频文件仍用 <video> 播放", () => {
    const html = render("/api/files/3e6ddf7c-cb15-4c2f-a9f6-3a427a1e95cc");
    expect(html).toContain('<video src="/api/files/3e6ddf7c');
  });
  it("外站直链视频文件仍用 <video>", () => {
    expect(videoSource("https://cdn.example.com/clip.mp4")?.kind).toBe("file");
    expect(render("https://cdn.example.com/clip.webm")).toContain("<video");
  });
  it("未登记平台的网页链接降级为跳转卡片而不是无法播放的 <video>", () => {
    // Bilibili 已由 src/modules/embed 注册表接管（见 tests/embed-rendering.test.tsx）。
    const html = render("https://vimeo.com/123456?share=copy");
    expect(html).not.toContain("<video");
    expect(html).toContain("video-link");
    expect(html).toContain("在 vimeo.com 观看视频");
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("视频块里的 YouTube 页面链接改用隐私增强 iframe", () => {
    const html = render("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(html).not.toContain("<video");
    expect(html).toContain(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
  it("危险协议的视频链接不渲染", () => {
    expect(render("javascript:alert(1)")).toBe(
      '<div class="reader-block"></div>',
    );
  });
});

describe("上传前检查（BlockNote 只显示通用上传失败）", () => {
  it("超过 25 MB 给出中文原因", () => {
    const p = mediaUploadProblem({
      size: MAX_MEDIA_BYTES + 1,
      type: "video/mp4",
    });
    expect(p?.reason).toBe("too_large");
    expect(p?.message).toContain("25 MB");
  });
  it("MOV/MKV 等不支持的格式给出中文原因", () => {
    expect(
      mediaUploadProblem({ size: 10, type: "video/quicktime" })?.reason,
    ).toBe("unsupported_type");
    expect(mediaUploadProblem({ size: 10, type: "" })?.message).toContain(
      "未知类型",
    );
  });
  it("空文件被拒绝，合规 MP4 通过", () => {
    expect(mediaUploadProblem({ size: 0, type: "video/mp4" })?.reason).toBe(
      "empty",
    );
    expect(mediaUploadProblem({ size: 1024, type: "video/mp4" })).toBeNull();
  });
});
