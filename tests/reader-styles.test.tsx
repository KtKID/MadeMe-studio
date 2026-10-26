import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockReader from "../src/components/content/BlockReader";
describe("富文本样式白名单保真", () => {
  it("BlockNote默认文字颜色、背景高亮及合法hex得到保留", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "红字高亮",
                styles: { textColor: "red", backgroundColor: "yellow" },
              },
              {
                type: "text",
                text: "自定义",
                styles: { textColor: "#12AbCd", backgroundColor: "#fff8" },
              },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain("color:var(--reader-red-text)");
    expect(html).toContain("background-color:var(--reader-yellow-background)");
    expect(html).toContain("color:#12AbCd");
    expect(html).toContain("background-color:#fff8");
  });
  it("任意CSS与URL字符串不会成为样式", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "paragraph",
            props: {
              textAlignment: "right;position:fixed",
              textColor: "var(--evil)",
              backgroundColor: "url(https://evil.test/x)",
            },
            content: [
              {
                type: "text",
                text: "安全内容",
                styles: {
                  textColor: "red;background:url(https://evil.test/x)",
                  backgroundColor: "expression(alert(1))",
                },
              },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain("安全内容");
    for (const bad of [
      "evil.test",
      "position:fixed",
      "expression",
      "--evil",
      "background:url",
    ])
      expect(html).not.toContain(bad);
  });
  it("块与列表对齐只接受left/center/right/justify", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "heading",
            props: { level: 2, textAlignment: "center" },
            content: "居中标题",
          },
          {
            type: "numberedListItem",
            props: { textAlignment: "right" },
            content: "靠右条目",
          },
          {
            type: "paragraph",
            props: { textAlignment: "justify" },
            content: "两端对齐",
          },
        ]}
      />,
    );
    expect(html).toContain("text-align:center");
    expect(html).toContain("text-align:right");
    expect(html).toContain("text-align:justify");
  });
  it("图片尺寸以数值clamp并保持响应式，不接收CSS宽度字符串", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          { type: "image", props: { url: "/api/files/a", previewWidth: 640 } },
          {
            type: "image",
            props: { url: "/api/files/b", previewWidth: 99999999 },
          },
          { type: "image", props: { url: "/api/files/c", previewWidth: -9 } },
          {
            type: "image",
            props: {
              url: "/api/files/d",
              previewWidth: "url(https://evil.test)",
            },
          },
          {
            type: "image",
            props: { url: "/api/files/e", previewWidth: Infinity },
          },
        ]}
      />,
    );
    expect(html).toContain('width="640"');
    expect(html).toContain('width="4096"');
    expect(html).toContain('width="32"');
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("Infinity");
    expect(html.match(/width="/g)?.length).toBe(3);
  });
});
