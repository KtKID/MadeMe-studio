import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockReader, { embedUrl } from "../src/components/content/BlockReader";
import Dashboard from "../src/components/content/Dashboard";
import PublicFeed from "../src/components/content/PublicFeed";
import { safeUrl } from "../src/components/shared/ui";
import {
  defaultSettings,
  type BootstrapResponse,
} from "../src/shared/contracts";
const empty: BootstrapResponse = {
  posts: [],
  settings: defaultSettings,
  capabilities: {
    authenticated: true,
    aiConfigured: false,
    imageConfigured: false,
    storageConfigured: true,
    ownerConfigured: true,
  },
};
describe("公开渲染安全边界", () => {
  it("富文本按文本转义，绝不执行任意 HTML", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "<script>alert(1)</script>",
                styles: { bold: true },
              },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>");
  });
  it("拒绝 javascript、data 和非白名单嵌入", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html,<script>")).toBeUndefined();
    expect(
      embedUrl("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
    expect(embedUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("YouTube 使用隐私增强域名，X 保持安全跳转卡片", () => {
    expect(embedUrl("https://youtu.be/dQw4w9WgXcQ")?.embed).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(embedUrl("https://x.com/example/status/123")?.type).toBe("x");
  });
  it("危险链接降级为普通文字", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "paragraph",
            content: [
              {
                type: "link",
                href: "javascript:alert(1)",
                content: [{ type: "text", text: "点击", styles: {} }],
              },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain("点击");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a");
  });
  it("图片替代文本安全转义", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "image",
            props: {
              url: "/api/files/test-image",
              caption: '" onerror="alert(1)',
            },
          },
        ]}
      />,
    );
    expect(html).toContain("&quot;");
    expect(html).not.toContain(' onerror="');
  });
});
describe("不完整历史块兼容", () => {
  it("缺少 cells 的旧表格不会导致整篇文章崩溃", () => {
    expect(() =>
      renderToStaticMarkup(
        <BlockReader
          blocks={[
            {
              type: "table",
              content: {
                rows: [{}, null, { cells: 42 }, { cells: [null, "保留文字"] }],
              },
            },
          ]}
        />,
      ),
    ).not.toThrow();
  });
});
describe("界面冒烟：真实空状态，不伪造数据", () => {
  it("写作台空状态显示零文章与可达的新建入口", () => {
    const html = renderToStaticMarkup(<Dashboard initial={empty} />);
    expect(html).toContain("0 篇文章");
    expect(html).toContain("/studio/new");
    expect(html).toContain("你的下一篇好文章");
  });
  it("访客首页没有捏造示例文章或创作权限", () => {
    const html = renderToStaticMarkup(
      <PublicFeed posts={[]} authenticated={false} />,
    );
    expect(html).toContain("好故事，正在酝酿");
    expect(html).not.toContain("/studio/new");
    expect(html).not.toContain("article-card-body");
  });
  it("无作者身份的写作台明确只读", () => {
    const html = renderToStaticMarkup(
      <Dashboard
        initial={{
          ...empty,
          capabilities: { ...empty.capabilities, authenticated: false },
        }}
      />,
    );
    expect(html).toContain("当前为只读模式");
  });
});

describe("独立首页布局", () => {
  for (const theme of ["paper", "ink", "garden", "mono"] as const) {
    it(`${theme}布局标记可供独立布局规则选择`, () => {
      expect(
        renderToStaticMarkup(
          <PublicFeed posts={[]} authenticated={false} theme={theme} />,
        ),
      ).toContain(`data-layout="${theme}"`);
    });
  }
});
