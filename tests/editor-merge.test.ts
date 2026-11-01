import { describe, it, expect } from "vitest";
import {
  mergePost,
  chooseLocalConflicts,
} from "../src/components/editor/post-merge";
import { defaultPost } from "./fixtures/editor-post";
describe("编辑器字段三方合并", () => {
  it("服务器改正文、本地改标题，两边都保留", () => {
    const b = defaultPost(),
      local = { ...b, title: "本地标题" },
      remote = {
        ...b,
        version: 2,
        blocks: [{ type: "paragraph", content: "新正文" }],
      };
    const r = mergePost(b, local, remote);
    expect(r.conflicts).toEqual([]);
    expect(r.post).toMatchObject({
      title: local.title,
      blocks: remote.blocks,
      version: 2,
    });
  });
  it("同字段不同值冲突；相同值无需选择", () => {
    const b = defaultPost();
    expect(
      mergePost(b, { ...b, title: "甲" }, { ...b, title: "乙" }).conflicts,
    ).toEqual(["title"]);
    expect(
      mergePost(b, { ...b, title: "甲" }, { ...b, title: "甲" }).conflicts,
    ).toEqual([]);
  });
  it("正文整篇冲突，不拼接；保留本地不覆盖远端独立字段", () => {
    const b = defaultPost(),
      l = { ...b, blocks: [{ type: "paragraph", content: "本地正文" }] },
      r = {
        ...b,
        title: "远端标题",
        blocks: [{ type: "paragraph", content: "远端正文" }],
      };
    const m = mergePost(b, l, r);
    expect(m.conflicts).toEqual(["blocks"]);
    expect(chooseLocalConflicts(m, l)).toMatchObject({
      title: r.title,
      blocks: l.blocks,
    });
  });
  it("封面和裁切是一个字段，分类id与名称也是一个字段", () => {
    const b = defaultPost(),
      l = { ...b, coverImage: "/api/files/b", category: "本地分类" },
      r = {
        ...b,
        coverSettings: {
          aspect: "1:1" as const,
          fit: "cover" as const,
          focusX: 10,
          focusY: 50,
          zoom: 1,
        },
        categoryId: "remote",
      };
    expect(mergePost(b, l, r).conflicts).toEqual(["category", "coverImage"]);
  });
});
