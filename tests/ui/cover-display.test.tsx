// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import CoverFrame from "../../src/modules/cover/CoverFrame";
import PublicFeed from "../../src/components/content/PublicFeed";
import Dashboard from "../../src/components/content/Dashboard";
import { defaultSettings, type Post } from "../../src/shared/contracts";
import type { CoverSettings } from "../../src/modules/cover/contracts";

afterEach(cleanup);
const wide: CoverSettings = {
  aspect: "16:9",
  fit: "cover",
  focusX: 10,
  focusY: 90,
  zoom: 2,
};
const post = (id: string, coverSettings?: CoverSettings): Post => ({
  id,
  title: id,
  slug: id,
  category: "",
  excerpt: "摘要",
  tags: [],
  blocks: [],
  coverImage: `/api/files/${id}`,
  ...(coverSettings ? { coverSettings } : {}),
  visibility: "public",
  pinned: false,
  version: 1,
  publishedAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
  deletedAt: null,
});

describe("封面展示组件（SSR 可用于文章页）", () => {
  it("预设比例：固定框比例 + 同一套定位缩放", () => {
    const html = renderToStaticMarkup(
      <CoverFrame src="/api/files/a" settings={wide} alt="标题" />,
    );
    expect(html).toContain('data-aspect="16:9"');
    expect(html).toContain('data-fit="cover"');
    expect(html).toContain("--cover-ratio:1.777778");
    expect(html).toContain("object-position:10% 90%");
    expect(html).toContain("transform:scale(2)");
    expect(html).toContain('alt="标题"');
  });
  it("缺设置的旧文章按默认：原图比例 + 完整显示", () => {
    const html = renderToStaticMarkup(<CoverFrame src="/api/files/a" />);
    expect(html).toContain('data-aspect="original"');
    expect(html).toContain('data-fit="contain"');
    expect(html).not.toContain("--cover-ratio");
    expect(html).not.toContain("scale(");
  });
  it("缩略图模式只是等比缩小同一封面", () => {
    const html = renderToStaticMarkup(
      <CoverFrame src="/api/files/a" settings={wide} variant="thumb" />,
    );
    expect(html).toContain("cover-frame--thumb");
    expect(html).toContain("object-position:10% 90%");
    expect(html).toContain("transform:scale(2)");
  });
});

describe("首页位置画框与文章/工作台封面设置", () => {
  it("字体迟到时，搜索已改变版面不再执行旧测量", async () => {
    let resolveFonts!: () => void;
    const fonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: new Promise<void>((resolve) => {
          resolveFonts = resolve;
        }),
      },
    });
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const width = vi
      .spyOn(Element.prototype, "clientWidth", "get")
      .mockReturnValue(1140);
    try {
      const view = render(
        <PublicFeed
          posts={[post("one"), post("two"), post("three")]}
          authenticated={false}
        />,
      );
      view.rerender(<PublicFeed posts={[post("one")]} authenticated={false} />);
      await act(async () => {
        resolveFonts();
      });
      expect(disconnect).toHaveBeenCalled();
      expect(
        view.container.querySelectorAll(".home-featured-measure"),
      ).toHaveLength(0);
      expect(view.container.querySelectorAll(".home-post")).toHaveLength(1);
    } finally {
      cleanup();
      width.mockRestore();
      vi.unstubAllGlobals();
      if (fonts) Object.defineProperty(document, "fonts", fonts);
      else Reflect.deleteProperty(document, "fonts");
    }
  });
  it("刊物首页独立画框，保留每篇焦点和缩放，不改原设置", () => {
    const { container } = render(
      <PublicFeed
        posts={[post("one", wide), post("legacy")]}
        authenticated={false}
      />,
    );
    const frames = [
      ...container.querySelectorAll<HTMLElement>(".article-card .home-cover"),
    ];
    expect(frames).toHaveLength(2);
    expect(frames[0].querySelector("img")!.style.objectPosition).toBe(
      "10% 90%",
    );
    expect(frames[0].querySelector("img")!.style.transform).toBe("scale(2)");
    expect(frames[1].querySelector("img")!.style.objectFit).toBe("cover");
    expect(frames[1].querySelector("img")!.style.objectPosition).toBe(
      "50% 50%",
    );
    expect(wide).toEqual({
      aspect: "16:9",
      fit: "cover",
      focusX: 10,
      focusY: 90,
      zoom: 2,
    });
    expect(
      container
        .querySelector(".article-card-visual")!
        .classList.contains("has-cover"),
    ).toBe(true);
  });
  it("其他首页主题仍沿用文章自己的封面设置", () => {
    const { container } = render(
      <PublicFeed
        posts={[post("one", wide), post("legacy")]}
        authenticated={false}
        theme="ink"
      />,
    );
    expect(
      [...container.querySelectorAll<HTMLElement>(".cover-frame")].map(
        (f) => f.dataset.aspect,
      ),
    ).toEqual(["16:9", "original"]);
  });
  it("工作台缩略图使用同一设置，不另行裁切", () => {
    const { container } = render(
      <Dashboard
        initial={{
          settings: defaultSettings,
          posts: [post("one", wide)],
          capabilities: {
            authenticated: true,
            aiConfigured: false,
            imageConfigured: false,
            passwordConfigured: false,
            storageConfigured: true,
            ownerConfigured: true,
          },
        }}
      />,
    );
    const frame = container.querySelector<HTMLElement>(
      ".post-thumb .cover-frame",
    )!;
    expect(frame.dataset.aspect).toBe("16:9");
    expect(frame.classList.contains("cover-frame--thumb")).toBe(true);
  });
});

describe("封面样式约束", () => {
  const css = readFileSync("src/modules/cover/styles.css", "utf8");
  const global = readFileSync("src/styles/global.css", "utf8");
  it("白色补边、最大 1024×1024", () => {
    expect(css).toMatch(/--cover-fill:\s*#ffffff/);
    expect(css).toContain("1024px");
    expect(css).toMatch(/object-fit|cover-frame/);
  });
  it("旧的固定高度与二次裁切已移除", () => {
    expect(global).not.toMatch(/\.editor-cover\s*\{[^}]*height:\s*230px/);
    expect(global).not.toMatch(/\.editor-cover\s*\{[^}]*height:\s*160px/);
    expect(global).not.toMatch(
      /\.reading-cover img\s*\{[^}]*object-fit:\s*cover/,
    );
    expect(global).not.toMatch(/\.post-thumb img\s*\{[^}]*object-fit:\s*cover/);
  });
});
