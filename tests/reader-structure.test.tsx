import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BlockReader from "../src/components/content/BlockReader";
describe("BlockNote结构的服务端阅读语义", () => {
  it("连续编号同属一个ol，显式start通过li value重置并继续", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          { type: "numberedListItem", content: "一" },
          { type: "numberedListItem", content: "二" },
          { type: "numberedListItem", props: { start: 7 }, content: "七" },
          { type: "numberedListItem", content: "八" },
          { type: "paragraph", content: "分隔" },
          { type: "numberedListItem", props: { start: 3 }, content: "新列表" },
        ]}
      />,
    );
    expect(html.match(/<ol(?:\s|>)/g)?.length).toBe(2);
    expect(html).toContain('<li value="7"');
    expect(html).toContain('<ol start="3"');
    expect(html.match(/<li(?:\s|>)/g)?.length).toBe(5);
  });
  it("真实tableCell合并属性和表头行被保留", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "table",
            content: {
              type: "tableContent",
              headerRows: 1,
              rows: [
                {
                  cells: [
                    {
                      type: "tableCell",
                      props: { colspan: 2, rowspan: 1 },
                      content: [{ type: "text", text: "合并表头", styles: {} }],
                    },
                  ],
                },
                {
                  cells: [
                    {
                      type: "tableCell",
                      props: { rowspan: 2, colspan: 1 },
                      content: [{ type: "text", text: "跨行", styles: {} }],
                    },
                    {
                      type: "tableCell",
                      props: { rowspan: 1, colspan: 1 },
                      content: [{ type: "text", text: "普通", styles: {} }],
                    },
                  ],
                },
                {
                  cells: [
                    {
                      type: "tableCell",
                      props: { colspan: 1, rowspan: 1 },
                      content: [{ type: "text", text: "下一行", styles: {} }],
                    },
                  ],
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(html).toContain("<thead>");
    expect(html).toContain('<th colSpan="2"');
    expect(html).toContain('rowSpan="2"');
    expect(html).toContain('scope="colgroup"');
    expect(html).toContain("合并表头");
  });
  it("恶意或不合法span不会变成HTML属性执行内容", () => {
    const html = renderToStaticMarkup(
      <BlockReader
        blocks={[
          {
            type: "table",
            content: {
              headerRows: 1,
              rows: [
                {
                  cells: [
                    {
                      type: "tableCell",
                      props: {
                        colspan: "2 onclick=alert(1)",
                        rowspan: Infinity,
                      },
                      content: "安全",
                    },
                  ],
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("Infinity");
    expect(html).toContain('colSpan="1"');
  });
});
