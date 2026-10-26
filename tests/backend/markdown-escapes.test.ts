import { describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../src/server/content/markdown";
import { blocksSchema, type EditorBlock } from "../../src/shared/contracts";
type Inline = {
  type: string;
  text?: string;
  styles?: Record<string, boolean>;
  href?: string;
  content?: Inline[];
};
function content(block: EditorBlock) {
  return block.content as unknown as Inline[];
}
function textOf(parts: Inline[]): string {
  return parts
    .map((part) =>
      part.type === "link" ? textOf(part.content ?? []) : (part.text ?? ""),
    )
    .join("");
}
function parsedText(markdown: string) {
  const blocks = markdownToBlocks(markdown);
  blocksSchema.parse(blocks);
  return {
    blocks,
    parts: content(blocks[0]),
    text: textOf(content(blocks[0])),
  };
}
describe("Markdown标点转义回归：先测再修", () => {
  it("转义强调和链接标点还原文字，不生成样式或链接", () => {
    const value = parsedText(
      String.raw`\*literal\* \_plain\_ \[x\]\(https://example.test\)`,
    );
    expect(value.text).toBe("*literal* _plain_ [x](https://example.test)");
    expect(
      value.parts.every(
        (p) => p.type === "text" && Object.keys(p.styles ?? {}).length === 0,
      ),
    ).toBe(true);
  });
  it("剪藏选区的转义图片和HTML只作为引用文字", () => {
    const value = parsedText(
      String.raw`> \!\[photo\](https://example.test/private.png) \<script\>alert(1)\</script\>`,
    );
    expect(value.blocks[0].type).toBe("quote");
    expect(value.text).toBe(
      "![photo](https://example.test/private.png) <script>alert(1)</script>",
    );
    expect(value.parts.every((p) => p.type === "text")).toBe(true);
    expect(value.blocks.some((b) => b.type === "image")).toBe(false);
  });
  it("支持CommonMark全部ASCII标点转义，非标点反斜线原样保留", () => {
    const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    const escaped = [...punctuation].map((char) => `\\${char}`).join(" ");
    expect(parsedText(escaped).text).toBe([...punctuation].join(" "));
    expect(parsedText(String.raw`C:\Users\writer \中文 \a`).text).toBe(
      String.raw`C:\Users\writer \中文 \a`,
    );
  });
  it("行内代码和围栏代码里的反斜线不执行转义", () => {
    const inline = parsedText("`\\*literal\\* \\[x\\]`");
    expect(inline.parts).toEqual([
      {
        type: "text",
        text: String.raw`\*literal\* \[x\]`,
        styles: { code: true },
      },
    ]);
    const fenced = markdownToBlocks("```text\n\\*literal\\* \\[x\\]\n```");
    expect(fenced[0].type).toBe("codeBlock");
    expect(textOf(content(fenced[0]))).toBe(String.raw`\*literal\* \[x\]`);
  });
  it("合法粗体、链接与其内部转义仍正确解析", () => {
    const value = parsedText(
      String.raw`**bold \* marker** and [safe](https://example.test/a\_b)`,
    );
    expect(value.parts[0]).toEqual({
      type: "text",
      text: "bold * marker",
      styles: { bold: true },
    });
    expect(value.parts.at(-1)).toEqual({
      type: "link",
      href: "https://example.test/a_b",
      content: [{ type: "text", text: "safe", styles: {} }],
    });
  });
  it("成对反斜线不会误屏蔽后续合法强调，原始私用字符不被占位符吞掉", () => {
    const value = parsedText("\\\\*italic* \uE0000\uE000 \\*plain\\*");
    expect(value.text).toBe("\\italic \uE0000\uE000 *plain*");
    expect(
      value.parts.some((p) => p.text === "italic" && p.styles?.italic),
    ).toBe(true);
  });
});
