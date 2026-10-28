import { describe, expect, it } from "vitest";
import {
  prepareExport,
  replaceMarkdownMediaUrl,
} from "../src/modules/local-export/prepare";
import { exportSnapshotSchema } from "../src/modules/local-export/contracts";

const origin = "https://studio.example";
const snapshot = {
  articleId: "post-1",
  title: "当前稿",
  markdown: "此刻正文",
  blocks: [],
};

describe("本地导出准备", () => {
  it("校验快照协议且不接受未知字段", () => {
    expect(
      exportSnapshotSchema.safeParse({ ...snapshot, articleId: "" }).success,
    ).toBe(false);
    expect(
      exportSnapshotSchema.safeParse({ ...snapshot, token: "secret" }).success,
    ).toBe(false);
  });
  it("保留当前 Markdown、标题和有损提示，不修改输入", () => {
    const result = prepareExport(snapshot, origin);
    expect(result.markdown).toContain("# 当前稿");
    expect(result.markdown).toContain("此刻正文");
    expect(result.warnings.join(" ")).toMatch(/Markdown.*有损/);
    expect(snapshot.markdown).toBe("此刻正文");
  });
  it("递归收集作者私有图片并保留 ID 和原名", () => {
    const result = prepareExport(
      {
        ...snapshot,
        blocks: [
          {
            type: "paragraph",
            children: [
              {
                type: "image",
                props: { url: "/api/files/media-1", name: "原图.png" },
              },
            ],
          },
        ],
      },
      origin,
    );
    expect(result.media).toEqual([
      { id: "media-1", url: "/api/files/media-1", name: "原图.png" },
    ]);
    expect(result.markdown).toContain("/api/files/media-1");
  });
  it("相同媒体的绝对/相对 URL 合并并归一 Markdown", () => {
    const result = prepareExport(
      {
        ...snapshot,
        markdown:
          "![a](/api/files/media-1)\n![b](https://studio.example/api/files/media-1)",
        blocks: [
          {
            type: "image",
            props: { url: "/api/files/media-1", name: "a.png" },
          },
          {
            type: "image",
            props: {
              url: "https://studio.example/api/files/media-1",
              name: "a.png",
            },
          },
        ],
      },
      origin,
    );
    expect(result.media).toHaveLength(1);
    expect(result.markdown).not.toContain("https://studio.example");
  });
  it("外部图片仍列为必须下载的媒体，而跨站同路径不冒充站内 ID", () => {
    const url = "https://images.example/api/files/photo.png";
    const result = prepareExport(
      { ...snapshot, blocks: [{ type: "image", props: { url } }] },
      origin,
    );
    expect(result.media[0]).toEqual({ id: url, url, name: "photo.png" });
  });
  it("封面纳入媒体与正文", () => {
    const result = prepareExport(
      { ...snapshot, coverUrl: "/api/files/cover-1" },
      origin,
    );
    expect(result.media[0]?.id).toBe("cover-1");
    expect(result.markdown).toContain("![封面](/api/files/cover-1)");
  });
  it("平台视频与嵌入保留链接而非伪造下载", () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const result = prepareExport(
      {
        ...snapshot,
        blocks: [
          { type: "video", props: { url } },
          { type: "embed", props: { url: "https://x.com/example/status/123" } },
        ],
      },
      origin,
    );
    expect(result.media).toEqual([]);
    expect(result.markdown).toContain(url);
    expect(result.markdown).toContain("https://x.com/example/status/123");
    expect(result.warnings.join(" ")).toContain("链接");
  });
  it("文件、音视频直链纳入媒体，不能悄悄丢附件", () => {
    const result = prepareExport(
      {
        ...snapshot,
        blocks: [
          {
            type: "file",
            props: { url: "/api/files/file-1", name: "附件.pdf" },
          },
        ],
      },
      origin,
    );
    expect(result.media[0]?.name).toBe("附件.pdf");
    expect(result.markdown).toContain("/api/files/file-1");
  });
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,eA==",
    "blob:https://studio.example/test",
    "https://user:secret@images.example/a.png",
  ])("拒绝不可完整导出的 URL %s", (url) => {
    expect(() =>
      prepareExport(
        { ...snapshot, blocks: [{ type: "image", props: { url } }] },
        origin,
      ),
    ).toThrow();
  });
  it("空图片不能被报告为完整导出", () => {
    expect(() =>
      prepareExport(
        { ...snapshot, blocks: [{ type: "image", props: { url: "" } }] },
        origin,
      ),
    ).toThrow(/图片|媒体/);
  });
});

it("URL 重写只改完整 Markdown 目标，绝对别名不拼接双站点", () => {
  const raw =
    "![a](https://studio.example/api/files/one)\n![b](/api/files/one)\n![c](/api/files/one-more)\n正文 /api/files/one";
  expect(
    replaceMarkdownMediaUrl(raw, "/api/files/one", "../asset/one.png"),
  ).toBe(
    "![a](https://studio.example/api/files/one)\n![b](../asset/one.png)\n![c](/api/files/one-more)\n正文 /api/files/one",
  );
  const result = prepareExport(
    {
      ...snapshot,
      markdown: raw,
      blocks: [
        {
          type: "image",
          props: { url: "https://studio.example/api/files/one" },
        },
        { type: "image", props: { url: "/api/files/one" } },
      ],
    },
    origin,
  );
  expect(result.markdown).not.toContain("https://studio.examplehttps:");
});
it("URL 正则元字符按字面匹配", () => {
  const url = "https://image.example/a(1).png?x=1&y=2";
  expect(replaceMarkdownMediaUrl(`![x](<${url}>)`, url, "../asset/a.png")).toBe(
    "![x](<../asset/a.png>)",
  );
});
it("保留 fenced code 与 inline code 内的 Markdown 示例", () => {
  const from = "/api/files/one";
  const markdown =
    "![real](/api/files/one)\n`![inline](/api/files/one)`\n````md\n![code](/api/files/one)\n```\n````\n~~~md\n![tilde](/api/files/one)\n~~~\n![after](/api/files/one)";
  expect(replaceMarkdownMediaUrl(markdown, from, "asset/one.png")).toBe(
    "![real](asset/one.png)\n`![inline](/api/files/one)`\n````md\n![code](/api/files/one)\n```\n````\n~~~md\n![tilde](/api/files/one)\n~~~\n![after](asset/one.png)",
  );
});
it("多反引号代码跨度及未闭合围栏不被重写", () => {
  expect(
    replaceMarkdownMediaUrl(
      "`` ` ![x](/api/files/one) ``\n~~~\n![x](/api/files/one)",
      "/api/files/one",
      "asset/x.png",
    ),
  ).toBe("`` ` ![x](/api/files/one) ``\n~~~\n![x](/api/files/one)");
});
