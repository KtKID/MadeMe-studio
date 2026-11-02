import { describe, it, expect } from "vitest";
import {
  attachmentPlan,
  prepareAttachments,
  mediaReferences,
} from "../../src/modules/markdown-import/attachments";
import { markdownToBlocks } from "../../src/server/content/markdown";
import { applyMediaKinds } from "../../src/modules/markdown-import/attachments";
import { createPostSchema } from "../../src/shared/contracts";
import { fromMarkdown } from "mdast-util-from-markdown";

const asset = (path: string, type = "image/png") => ({
  path,
  file: new File(["test"], path.split("/").at(-1)!, { type }),
});
describe("Markdown 附件导入", () => {
  it("实际CommonMark解析未定义图片引用为文字，已定义引用才有imageReference", () => {
    for (const markdown of ["![a][missing]", "![missing][]", "![missing]"]) {
      const tree = fromMarkdown(markdown);
      expect(JSON.stringify(tree)).not.toContain('"type":"imageReference"');
      expect(mediaReferences(markdown)).toEqual([]);
      expect(JSON.stringify(markdownToBlocks(markdown))).toContain(markdown);
    }
    expect(
      JSON.stringify(
        fromMarkdown("![a][ref]\n\n[ref]: https://example.com/x.png"),
      ),
    ).toContain('"type":"imageReference"');
  });
  it("准备附件统一BOM与CRLF/CR，不混入两套换行", async () => {
    const result = await prepareAttachments(
      "\uFEFF# title\r\n\r\n![x](x.png)\r\n\r尾段",
      [asset("x.png")],
      { mode: "selected" },
      async () => ({ url: "/api/files/id", mime: "image/png" }),
    );
    expect(result.markdown).not.toContain("\r");
    expect(result.markdown).not.toContain("\uFEFF");
    expect(result.markdown).toContain("# title\n");
    expect(result.markdown).toContain("尾段");
  });
  it("不支持的远程协议明确提示HTTPS且不回显远程凭据", () => {
    for (const value of [
      "http://secret:password@example.com/x.png",
      "ftp://example.com/x.png",
    ]) {
      expect(() =>
        attachmentPlan(`![x](${value})`, [], { mode: "selected" }),
      ).toThrow(/远程媒体仅支持 HTTPS/);
      expect(() =>
        attachmentPlan(`![x](${value})`, [], { mode: "selected" }),
      ).not.toThrow(/password/);
    }
  });
  it("wiki的合法笔记相对父级不被另一个根路径解释误拒绝", () => {
    expect(
      attachmentPlan(
        "![[./../自媒体/assets/x.png]]",
        [asset("自媒体/assets/x.png")],
        { mode: "root", documentPath: "个人AgentOS/test.md" },
      )[0].asset.path,
    ).toBe("自媒体/assets/x.png");
    expect(() =>
      attachmentPlan("![[./../../x.png]]", [asset("x.png")], {
        mode: "root",
        documentPath: "个人AgentOS/test.md",
      }),
    ).toThrow(/越界/);
  });
  it("音频/PDF转块保留现有字段，符合统一Zod输入协议", () => {
    for (const [mime, type] of [
      ["audio/mpeg", "audio"],
      ["application/pdf", "file"],
    ]) {
      const blocks = applyMediaKinds(
        markdownToBlocks("![附件](/api/files/test-id)"),
        { "/api/files/test-id": mime },
      );
      expect(blocks[0].type).toBe(type);
      expect(
        createPostSchema.safeParse({
          title: "测试",
          blocks,
          visibility: "draft",
        }).success,
      ).toBe(true);
    }
  });
  it("忽略代码和转义，解析标准、引用式和 wiki 媒体", () => {
    const refs = mediaReferences(
      "`![[secret.png]]`\n\n```md\n![x](secret.png)\n```\n\n\\![[skip.png]]\n\n![a](<../自媒体/assets/中文 空格.png>)\n\n![[assets/动画.gif|240]]\n\n![b][cover]\n\n[cover]: assets/video.mp4",
    );
    expect(refs.map((r) => r.target)).toEqual([
      "../自媒体/assets/中文 空格.png",
      "assets/动画.gif",
      "assets/video.mp4",
    ]);
  });
  it("以选中的文件夹为根解析中文、编码及父级路径；不上传无关文件", () => {
    const plan = attachmentPlan(
      "![a](../自媒体/assets/中文%20空格.png)\n![[动画.gif]]",
      [
        asset("自媒体/assets/中文 空格.png"),
        asset("assets/动画.gif", "image/gif"),
        asset("unused.png"),
      ],
      { documentPath: "文章/test.md", mode: "root" },
    );
    expect(plan.map((p) => p.asset.path)).toEqual([
      "自媒体/assets/中文 空格.png",
      "assets/动画.gif",
    ]);
  });
  it("宽松文件选择仍要求唯一同名匹配，文件夹模式拒绝越界和危险协议", () => {
    expect(() =>
      attachmentPlan("![[x.png]]", [asset("a/x.png"), asset("b/x.png")], {
        mode: "root",
        documentPath: "test.md",
      }),
    ).toThrow(/同名/);
    expect(() =>
      attachmentPlan("![x](../../x.png)", [asset("x.png")], {
        mode: "root",
        documentPath: "test.md",
      }),
    ).toThrow(/越界/);
    for (const target of [
      "file:///tmp/x.png",
      "data:image/png;base64,x",
      "//evil.test/x.png",
      "http://evil.test/x.png",
      "%2Ftmp/x.png",
      "..%2F..%2Fx.png",
    ]) {
      expect(() =>
        attachmentPlan(`![x](${target})`, [asset("x.png")], {
          mode: "root",
          documentPath: "note.md",
        }),
      ).toThrow();
    }
    expect(() =>
      attachmentPlan("![[missing.png]]", [], { mode: "selected" }),
    ).toThrow(/缺少/);
    expect(() =>
      attachmentPlan("![[secret.md]]", [asset("secret.md", "text/markdown")], {
        mode: "selected",
      }),
    ).toThrow(/不支持/);
  });
  it("去重上传并替换地址，已有安全地址不重复上传；失败和取消不返回部分正文", async () => {
    const md =
      "![x](../x.png)\n![[x.png]]\n![remote](https://example.com/a.png)\n![old](/api/files/old-id)";
    let uploads = 0;
    const options = { mode: "selected" as const };
    const cache = new Map();
    const prepared = await prepareAttachments(
      md,
      [asset("x.png")],
      options,
      async () => {
        uploads++;
        return { url: "/api/files/new-id", mime: "image/webp" };
      },
      { cache },
    );
    expect(uploads).toBe(1);
    expect(prepared.markdown).not.toContain("../x.png");
    expect(prepared.markdown).toContain("https://example.com/a.png");
    await expect(
      prepareAttachments("![[missing.png]]", [], options, async () => {
        throw Error("must not upload");
      }),
    ).rejects.toThrow(/缺少/);
    await expect(
      prepareAttachments("![[x.png]]", [asset("x.png")], options, async () => {
        throw Error("offline");
      }),
    ).rejects.toThrow("offline");
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareAttachments(
        "![[x.png]]",
        [asset("x.png")],
        options,
        async () => ({ url: "/api/files/id", mime: "image/png" }),
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
  it("服务端旧客户端不能静默丢弃相对地址；代码示例不受影响", () => {
    expect(() => markdownToBlocks("![x](../自媒体/assets/test.png)")).toThrow(
      /附件/,
    );
    expect(() => markdownToBlocks("![[test.gif]]")).toThrow(/附件/);
    expect(() => markdownToBlocks("```md\n![[test.gif]]\n```")).not.toThrow();
  });
  it("支持文件名中的百分号、NFC；引用路径只解码一次", () => {
    expect(
      attachmentPlan("![x](100%25.png)", [asset("100%.png")], {
        mode: "selected",
      }),
    ).toHaveLength(1);
    expect(
      attachmentPlan("![x](caf%C3%A9.png)", [asset("cafe\u0301.png")], {
        mode: "root",
        documentPath: "note.md",
      }),
    ).toHaveLength(1);
    expect(() =>
      attachmentPlan("![x](%252Ftmp.png)", [asset("tmp.png")], {
        mode: "root",
        documentPath: "note.md",
      }),
    ).toThrow(/缺少/);
  });
  it("链接包裹标准/引用式/wiki 图片在上传前明确拒绝，不破坏原文", async () => {
    for (const markdown of [
      "[![a](x.png)](https://example.com)",
      "[![a][image]][link]\n\n[image]: x.png\n[link]: https://example.com",
      "[![[x.png]]](https://example.com)",
    ]) {
      let uploads = 0;
      await expect(
        prepareAttachments(
          markdown,
          [asset("x.png")],
          { mode: "selected" },
          async () => {
            uploads++;
            return { url: "/api/files/test-id", mime: "image/png" };
          },
        ),
      ).rejects.toThrow(/链接/);
      expect(uploads).toBe(0);
    }
  });
  it("wiki 文件名按字面匹配百分号，Markdown URL 只解码一次；不会混淆两个文件", () => {
    const assets = [
      asset("100%.png"),
      asset("100%25.png"),
      asset("中文 空格.png"),
      asset("中文%20空格.png"),
    ];
    const options = { mode: "root" as const, documentPath: "note.md" };
    for (const name of [
      "100%.png",
      "100%25.png",
      "中文 空格.png",
      "中文%20空格.png",
    ]) {
      expect(
        attachmentPlan(`![[${name}]]`, assets, options)[0].asset.path,
      ).toBe(name);
    }
    expect(
      attachmentPlan("![a](100%25.png)", assets, options)[0].asset.path,
    ).toBe("100%.png");
    expect(
      attachmentPlan("![a](100%2525.png)", assets, options)[0].asset.path,
    ).toBe("100%25.png");
    expect(
      attachmentPlan("![a](中文%20空格.png)", assets, options)[0].asset.path,
    ).toBe("中文 空格.png");
    for (const markdown of [
      "![[../../x.png]]",
      "![a](..%2F..%2Fx.png)",
      "![[file:///tmp/x.png]]",
      "![[/etc/x.png]]",
    ])
      expect(() =>
        attachmentPlan(markdown, [asset("x.png")], options),
      ).toThrow();
  });
  it("大量代码内 wiki 不计入限额，真实引用边界128/129正确", () => {
    const code = "```\n![[ignore.png]]\n```\n\n".repeat(1500);
    expect(mediaReferences(code + "![[x.png]]\n".repeat(128))).toHaveLength(
      128,
    );
    expect(() => mediaReferences(code + "![[x.png]]\n".repeat(129))).toThrow(
      /128/,
    );
    expect(() => mediaReferences("![x](x.png)\n".repeat(129))).toThrow(/128/);
  });
  it("所有引用预检成功才上传；顺序惰性读取，取消不继续读取/保存", async () => {
    let read = 0,
      uploads = 0;
    await expect(
      prepareAttachments(
        "![[x.png]]\n![[missing.gif]]",
        [asset("x.png")],
        { mode: "selected" },
        async () => {
          uploads++;
          return { url: "/api/files/id", mime: "image/png" };
        },
      ),
    ).rejects.toThrow(/缺少/);
    expect(uploads).toBe(0);
    const controller = new AbortController();
    await expect(
      prepareAttachments(
        "![[x.png]]\n![[y.gif]]",
        [asset("x.png"), asset("y.gif", "image/gif")],
        { mode: "selected" },
        async () => {
          uploads++;
          controller.abort();
          return { url: "/api/files/id", mime: "image/png" };
        },
        {
          signal: controller.signal,
          readFile: async (input) => {
            read++;
            return input.file;
          },
        },
      ),
    ).rejects.toThrow();
    expect(read).toBe(1);
    expect(uploads).toBe(1);
  });
  it("HTML 媒体标签明确拒绝，避免伪装成可播放视频；代码里的 HTML 不受影响", () => {
    expect(() => mediaReferences('<video src="x.mp4"></video>')).toThrow(
      /HTML/,
    );
    expect(mediaReferences('```html\n<img src="x.png">\n```')).toEqual([]);
    try {
      markdownToBlocks('<img src="x.png">');
    } catch (e) {
      expect((e as { status: number }).status).toBe(422);
    }
  });
});
