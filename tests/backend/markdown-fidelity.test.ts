import { describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../src/server/content/markdown";
import { blocksSchema, type EditorBlock } from "../../src/shared/contracts";
import { validateContent } from "../../src/server/content/validation";
const children = (b: EditorBlock) => b.children as EditorBlock[];
const parse = (md: string) => blocksSchema.parse(markdownToBlocks(md));
describe("有界 Markdown 导入保真", () => {
  it("混合有序、无序、任务列表保留层级并正确退回同级", () => {
    const b = parse(
      "1. one\n   - child\n     - [x] done\n   - sibling\n2. two\n\n- separate",
    );
    expect(b.map((x) => x.type)).toEqual([
      "numberedListItem",
      "numberedListItem",
      "bulletListItem",
    ]);
    expect(children(b[0]).map((x) => x.type)).toEqual([
      "bulletListItem",
      "bulletListItem",
    ]);
    expect(children(children(b[0])[0])[0]).toMatchObject({
      type: "checkListItem",
      props: { checked: true },
    });
    validateContent(b);
  });
  it("表格转义竖线不增加列，偶数反斜线仍允许分隔", () => {
    const b = parse(String.raw`| a\|b | c |
| --- | --- |
| x\\ | y\|z |`);
    expect(b[0].content).toMatchObject({
      rows: [
        { cells: [[{ text: "a|b" }], [{ text: "c" }]] },
        { cells: [[{ text: "x\\" }], [{ text: "y|z" }]] },
      ],
    });
  });
  it("强调递归传递样式，链接标签与外层强调都保留", () => {
    const b = parse(
      "**bold *both* [*link*](https://example.test)** and ***triple*** and *outer **inner** end*",
    );
    expect(b[0].content).toEqual([
      { type: "text", text: "bold ", styles: { bold: true } },
      { type: "text", text: "both", styles: { bold: true, italic: true } },
      { type: "text", text: " ", styles: { bold: true } },
      {
        type: "link",
        href: "https://example.test",
        content: [
          { type: "text", text: "link", styles: { bold: true, italic: true } },
        ],
      },
      { type: "text", text: " and ", styles: {} },
      { type: "text", text: "triple", styles: { bold: true, italic: true } },
      { type: "text", text: " and ", styles: {} },
      { type: "text", text: "outer ", styles: { italic: true } },
      { type: "text", text: "inner", styles: { italic: true, bold: true } },
      { type: "text", text: " end", styles: { italic: true } },
    ]);
  });
  it("相邻闭合强调和下划线组合保留双重样式，代码不递归解释", () => {
    for (const md of ["**bold *both***", "__bold _both___"]) {
      expect(parse(md)[0].content).toEqual([
        { type: "text", text: "bold ", styles: { bold: true } },
        { type: "text", text: "both", styles: { bold: true, italic: true } },
      ]);
    }
    expect(
      parse("[**safe** `*literal*`](https://example.test)")[0].content,
    ).toEqual([
      {
        type: "link",
        href: "https://example.test",
        content: [
          { type: "text", text: "safe", styles: { bold: true } },
          { type: "text", text: " ", styles: {} },
          { type: "text", text: "*literal*", styles: { code: true } },
        ],
      },
    ]);
  });
  it("原始 HTML 和危险链接不生成执行节点", () => {
    const b = parse("<script>alert(1)</script> **[bad](javascript:alert)**");
    validateContent(b);
    expect(b[0].content).toEqual([
      { type: "text", text: "<script>alert(1)</script> ", styles: {} },
      { type: "text", text: "bad", styles: { bold: true } },
    ]);
  });
  it("长度和列表深度有显式边界，不截断或堆栈溢出", () => {
    expect(parse("x".repeat(1_000_000))[0].type).toBe("paragraph");
    expect(() => markdownToBlocks("x".repeat(1_000_001))).toThrow(/large/i);
    const list = (n: number) =>
      Array.from({ length: n }, (_, i) => `${"  ".repeat(i)}- item`).join("\n");
    validateContent(parse(list(10)));
    expect(() => markdownToBlocks(list(11))).toThrow(/nesting/i);
  });
});
