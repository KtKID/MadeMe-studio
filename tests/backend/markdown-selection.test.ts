import { it, expect } from "vitest";
import {
  appendSelectedAttachments,
  referenceDetails,
} from "../../src/modules/markdown-import/selection";
import {
  inspectAttachments,
  attachmentPlan,
  prepareAttachments,
  applyMediaKinds,
} from "../../src/modules/markdown-import/attachments";
import { markdownToBlocks } from "../../src/modules/markdown-import/blocks";
const file = (name: string, content = "image") =>
  new File([content], name, { type: "image/png" });
it("分次累加、同名同字节去重保留原File身份，不误合并不同文件名", async () => {
  const md = "![a](a.png)\n\n![b](b.png)",
    a = file("a.png");
  let assets = await appendSelectedAttachments(md, [], [a]);
  assets = await appendSelectedAttachments(md, assets, [file("b.png")]);
  assets = await appendSelectedAttachments(md, assets, [file("a.png")]);
  expect(assets).toHaveLength(2);
  expect(assets[0].file).toBe(a);
  expect(
    inspectAttachments(md, assets, { mode: "selected" }).every(
      (row) => row.asset,
    ),
  ).toBe(true);
});
it("同名同大小但不同内容必须保留并显式报冲突", async () => {
  const md = "![[a.png]]";
  const assets = await appendSelectedAttachments(
    md,
    await appendSelectedAttachments(md, [], [file("a.png", "AAA")]),
    [file("a.png", "BBB")],
  );
  expect(assets).toHaveLength(2);
  expect(() => attachmentPlan(md, assets, { mode: "selected" })).toThrow(
    /同名/,
  );
});
it("只匹配真正引用文件；重复的未引用文件不读取字节", async () => {
  const a = file("private.png"),
    b = file("private.png");
  a.arrayBuffer = b.arrayBuffer = async () => {
    throw Error("must not read");
  };
  const result = await appendSelectedAttachments(
    "纯文字",
    [{ path: a.name, file: a, explicit: true }],
    [b],
  );
  expect(result).toHaveLength(2);
});
it("检查重复时取消，不修改之前选择", async () => {
  const a = file("a.png"),
    b = file("a.png"),
    controller = new AbortController();
  let finish!: (data: ArrayBuffer) => void;
  b.arrayBuffer = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const original = [{ path: a.name, file: a, explicit: true }];
  const task = appendSelectedAttachments(
    "![[a.png]]",
    original,
    [b],
    controller.signal,
  );
  controller.abort();
  finish(new ArrayBuffer(0));
  await expect(task).rejects.toThrow();
  expect(original).toHaveLength(1);
});
it("文件夹与显式补选可一起匹配，补选不能绕过文件夹模式的越界检查", () => {
  const a = file("a.png"),
    b = file("b.png");
  const assets = [
    { path: "assets/a.png", file: a },
    { path: "b.png", file: b, explicit: true },
  ];
  expect(
    attachmentPlan("![a](../assets/a.png)\n![b](../assets/b.png)", assets, {
      mode: "root",
      documentPath: "notes/n.md",
    }),
  ).toHaveLength(2);
  expect(() =>
    attachmentPlan("![b](../../b.png)", assets, {
      mode: "root",
      documentPath: "notes/n.md",
    }),
  ).toThrow(/越界/);
});
it("远程嵌入视频/GIF保留而不上传，普通超链接仍是正文链接", async () => {
  const md =
    "![视频](https://media.example.test/clip.mp4)\n\n![动图](https://media.example.test/a.gif)\n\n[普通视频链接](https://media.example.test/link.mp4)";
  const rows = inspectAttachments(md, [], { mode: "selected" });
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.hosted)).toBe(true);
  expect(rows.map((row) => referenceDetails(row.ref).type)).toEqual([
    "视频",
    "GIF 动图",
  ]);
  const prepared = await prepareAttachments(
    md,
    [],
    { mode: "selected" },
    async () => {
      throw Error("must not upload");
    },
  );
  const blocks = applyMediaKinds(
    markdownToBlocks(prepared.markdown),
    prepared.mimeByUrl,
  );
  expect(blocks.map((block) => block.type)).toEqual([
    "video",
    "image",
    "paragraph",
  ]);
  expect(JSON.stringify(blocks[2])).toContain('"type":"link"');
});
