import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adviseVideoBlocks,
  findContentProblems,
} from "../../src/modules/content-check";
import { validateContent } from "../../src/server/content/validation";
import { AppError } from "../../src/server/errors";

const xSnippet = readFileSync("tests/fixtures/x-embed-snippet.html", "utf8");
const paragraph = (text: string, href?: string) => ({
  id: `p-${text}`,
  type: "paragraph",
  props: {},
  content: href
    ? [{ type: "link", href, content: [{ type: "text", text, styles: {} }] }]
    : [{ type: "text", text, styles: {} }],
  children: [],
});
const video = (id: string, url: string) => ({
  id,
  type: "video",
  props: { url, name: "" },
  children: [],
});

describe("findContentProblems：按块定位的中文原因", () => {
  it("用户场景：第 2 个视频块里是 X 嵌入代码", () => {
    const problems = findContentProblems([
      paragraph("开头"),
      video("v1", "/api/files/abc-123"),
      video("v2", xSnippet),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: "UNSAFE_URL",
      reason: "embed_snippet",
      blockId: "v2",
      blockType: "video",
      ordinal: 2,
      field: "url",
    });
    expect(problems[0].message).toContain(
      "第 2 个视频块里粘贴的是 X 的嵌入代码",
    );
    expect(problems[0].message).toContain("改为嵌入块");
    expect(problems[0].message).not.toContain("op7418");
  });
  it("非 https 视频地址、图片地址、行内链接、嵌入块分别给出原因；子块按文档顺序计数", () => {
    const problems = findContentProblems([
      video("v1", "ftp://example.com/a.mp4"),
      {
        id: "i1",
        type: "image",
        props: { url: "http://example.com/a.png" },
        children: [],
      },
      paragraph("点我", "javascript:alert(1)"),
      {
        ...paragraph("父"),
        children: [
          video("v2", "https://cdn.example.com/b.mp4"),
          video("v3", "data:video/mp4,AAAA"),
        ],
      },
      {
        id: "e1",
        type: "embed",
        props: { url: "https://vimeo.com/1" },
        children: [],
      },
    ]);
    expect(problems.map((p) => [p.blockType, p.ordinal, p.code])).toEqual([
      ["video", 1, "UNSAFE_URL"],
      ["image", 1, "UNSAFE_URL"],
      ["paragraph", 1, "UNSAFE_URL"],
      ["video", 3, "UNSAFE_URL"],
      ["embed", 1, "UNSAFE_EMBED"],
    ]);
    expect(problems[0].message).toContain(
      "第 1 个视频块的地址不是视频文件或支持的平台链接",
    );
    expect(problems[2].message).toContain("第 1 个段落里的链接无效");
    expect(problems[4].message).toContain("第 1 个嵌入块：暂不支持该网站");
  });
  it("合法内容没有问题", () => {
    expect(
      findContentProblems([
        paragraph("邮件", "mailto:a@example.com"),
        video("v1", "https://www.bilibili.com/video/BV1KW4y1j7AF/"),
        {
          id: "e1",
          type: "embed",
          props: { url: "https://x.com/a/status/1" },
          children: [],
        },
      ]),
    ).toEqual([]);
  });
});

describe("服务端 validateContent 返回同样的中文原因", () => {
  afterEach(() => vi.restoreAllMocks());
  it("422 UNSAFE_URL + details.problems，日志不含链接", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let error: unknown;
    try {
      validateContent([paragraph("a"), video("v9", xSnippet)] as never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppError);
    const app = error as AppError;
    expect(app.status).toBe(422);
    expect(app.code).toBe("UNSAFE_URL");
    expect(app.message).toContain("第 1 个视频块");
    expect(app.details).toMatchObject({
      problems: [
        {
          blockId: "v9",
          blockType: "video",
          ordinal: 1,
          reason: "embed_snippet",
        },
      ],
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("content.rejected");
    expect(logged).not.toContain("op7418");
    expect(logged).not.toContain("blockquote");
  });
  it("嵌入块仍返回 UNSAFE_EMBED 并写 embed.rejected（只含 reason/host）", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() =>
      validateContent([
        {
          type: "embed",
          props: { url: "https://evil.example/v?token=secret" },
        },
      ] as never),
    ).toThrow(expect.objectContaining({ code: "UNSAFE_EMBED" }));
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("embed.rejected");
    expect(logged).toContain("evil.example");
    expect(logged).not.toContain("token=secret");
  });
});

describe("adviseVideoBlocks：视频块里的平台内容", () => {
  it("X 链接或嵌入代码 → 改为嵌入块；YouTube 嵌入代码 → 自动规范化；认不出的代码 → 移除", () => {
    const advice = adviseVideoBlocks([
      video("a", xSnippet),
      video("b", "https://twitter.com/jack/status/20"),
      video(
        "c",
        '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      ),
      video("d", "<p>不是嵌入代码</p>"),
      video("e", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      video("f", "/api/files/abc"),
    ]);
    expect(advice.map((a) => [a.blockId, a.action, a.ordinal])).toEqual([
      ["a", "convert", 1],
      ["b", "convert", 2],
      ["c", "normalize", 3],
      ["d", "invalid", 4],
    ]);
    expect(advice[0]).toMatchObject({
      url: "https://x.com/op7418/status/2115000078104691168",
    });
    expect(advice[1]).toMatchObject({ url: "https://x.com/jack/status/20" });
    expect(advice[2]).toMatchObject({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });
});
