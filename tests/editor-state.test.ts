import { describe, it, expect } from "vitest";
import {
  EditClock,
  hasDocumentContent,
} from "../src/components/editor/editor-state";
describe("编辑事务防丢失", () => {
  it("延迟保存响应不能清除请求发出后的编辑", async () => {
    const clock = new EditClock();
    clock.edit();
    const sent = clock.snapshot();
    let finish!: () => void;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    clock.edit();
    finish();
    await response;
    expect(clock.acknowledge(sent)).toBe(false);
    expect(clock.dirty).toBe(true);
    expect(clock.snapshot()).toBe(2);
  });
  it("没有后续编辑的保存才可标记为干净", () => {
    const clock = new EditClock();
    clock.edit();
    const sent = clock.snapshot();
    expect(clock.acknowledge(sent)).toBe(true);
    expect(clock.dirty).toBe(false);
  });
  it("发布已保存快照不会把更新的本地修改清脏", () => {
    const clock = new EditClock();
    clock.edit();
    const published = clock.snapshot();
    clock.acknowledge(published);
    clock.edit();
    expect(clock.acknowledge(published)).toBe(false);
    expect(clock.dirty).toBe(true);
  });
  it("单个非空段落导入前必须确认", () => {
    expect(
      hasDocumentContent([
        { type: "paragraph", content: [{ type: "text", text: "已有正文" }] },
      ]),
    ).toBe(true);
  });
  it("附件、嵌套和表格也属于已有内容", () => {
    expect(
      hasDocumentContent([
        { type: "image", props: { url: "/api/files/test" } },
      ]),
    ).toBe(true);
    expect(
      hasDocumentContent([
        {
          type: "paragraph",
          content: [],
          children: [{ type: "paragraph", content: "嵌套文字" }],
        },
      ]),
    ).toBe(true);
    expect(
      hasDocumentContent([
        {
          type: "table",
          content: { rows: [{ cells: [[{ type: "text", text: "单元格" }]] }] },
        },
      ]),
    ).toBe(true);
  });
  it("唯一空段落不需要覆盖确认", () => {
    expect(hasDocumentContent([{ type: "paragraph", content: [] }])).toBe(
      false,
    );
  });
});
