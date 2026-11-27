import { expect, it } from "vitest";
import {
  parseImportMetadata,
  prepareImportDocument,
  appendCoverReference,
  finishCoverImport,
  hasStandaloneFirstImage,
} from "../../src/modules/markdown-import/metadata";
it("文件头提取明确字段并移除，封面和重复首图只留封面", () => {
  const input = parseImportMetadata(
    '---\ncid: c-test\ntitle: "标题"\ncover: images/a.png\nother: secret\n---\n![首图](images/a.png)\n正文',
  );
  expect(input).toEqual({
    cid: "c-test",
    title: "标题",
    cover: "images/a.png",
    markdown: "![首图](images/a.png)\n正文",
  });
  const marked = appendCoverReference(input.markdown, input.cover);
  expect(marked).toContain("images/a.png");
  const done = finishCoverImport(
    "![封面](/api/files/id)\n\n![首图](/api/files/id)\n\n正文",
    { "/api/files/id": "image/png" },
    true,
    true,
  );
  expect(done.cover).toBe("/api/files/id");
  expect(done.markdown).not.toContain("/api/files/id");
});

it("普通分隔符保留，未闭合代码围栏不会吞封面，正文内嵌图保留", () => {
  const ordinary = "---\n普通段落\n---\n正文";
  expect(parseImportMetadata(ordinary).markdown).toBe(ordinary);
  const text = appendCoverReference("```\n未关闭", "a.png");
  expect(text.startsWith("![封面]")).toBe(true);
  const inText = "![封面](/api/files/id)\n\n说明 ![图](/api/files/id)";
  expect(
    finishCoverImport(inText, { "/api/files/id": "image/png" }, true).markdown,
  ).toContain("说明 ![图]");
  const afterTitle =
    "![封面](/api/files/id)\n\n# 标题\n\n![首图](/api/files/id)\n\n正文";
  expect(
    finishCoverImport(afterTitle, { "/api/files/id": "image/png" }, true, true)
      .markdown,
  ).not.toContain("/api/files/id");
  expect(() =>
    parseImportMetadata("---\ncover: /api/files/id\n---\n正文"),
  ).toThrow(/本地图片路径/);
});

it("原始行内图片保留，缺结束符的属性区被拒绝，封面特殊文件名按字面匹配", () => {
  expect(hasStandaloneFirstImage("说明 ![图](a.png)")).toBe(false);
  expect(hasStandaloneFirstImage("# 标题\n\n![图](a.png)")).toBe(true);
  expect(parseImportMetadata("---\n---\n正文").markdown).toBe("正文");
  expect(() => parseImportMetadata("---\ncid: c-private\n正文")).toThrow(
    /结束标记/,
  );
  expect(appendCoverReference("", "图#1?.png")).toContain("图%231%3F.png");
});

it("属性拒绝控制字符，超长空白的普通水平线保持可读", () => {
  expect(() =>
    parseImportMetadata("---\ncover: |\n  a.png\n  b.png\n---\n正文"),
  ).toThrow(/格式/);
  const text = "---\n" + " ".repeat(200000) + "普通正文";
  expect(parseImportMetadata(text).markdown).toBe(text);
});

it.each([
  [
    "---\ntitle: 测试标题\n---\n# **测试标题** #\n\n正文",
    "测试标题",
    "\n\n正文",
  ],
  [
    "---\ntitle: 站内标题\n---\n# 内容标题\n\n正文",
    "站内标题",
    "# 内容标题\n\n正文",
  ],
  ["# 转义\\*标题\\* #\n\n正文", "转义*标题*", "\n\n正文"],
  ["# 正文标题\n\n## 次标题", "正文标题", "\n\n## 次标题"],
  ["正文\n\n# 中间标题", undefined, "正文\n\n# 中间标题"],
  ["```\n# 代码标题\n```", undefined, "```\n# 代码标题\n```"],
  ["## 二级标题\n\n# 中间标题", undefined, "## 二级标题\n\n# 中间标题"],
])("网页导入标题语义：%s", (raw, title, markdown) => {
  const prepared = prepareImportDocument(raw);
  expect(prepared.title).toBe(title);
  expect(prepared.markdown).toBe(markdown);
});

it.each([
  "# ![封面](images/cover.png) 标题\n\n正文",
  "# <span>标题</span>\n\n正文",
])("包含图片或 HTML 的首块保留且不自动充当标题：%s", (raw) => {
  const result = prepareImportDocument(raw);
  expect(result.title).toBeUndefined();
  expect(result.markdown).toBe(raw);
});

it("文件头标题存在时仍保留含图片的标题块，纯文本链接和行内代码可提取", () => {
  const raw =
    "---\ntitle: 图 标题\n---\n# [![图](a.png)](https://example.test) 标题\n\n正文";
  const result = prepareImportDocument(raw);
  expect(result.title).toBe("图 标题");
  expect(result.markdown).toContain("![图](a.png)");
  const plain = prepareImportDocument(
    "# [链接](https://example.test) 和 `代码`\n\n正文",
  );
  expect(plain.title).toBe("链接 和 代码");
  expect(plain.markdown).toBe("\n\n正文");
});
