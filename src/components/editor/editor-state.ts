/** 每次本地修改递增序号；服务器只能确认它实际收到的那一次快照。 */
export class EditClock {
  private revision = 0;
  private savedRevision = 0;
  edit() {
    this.revision += 1;
  }
  snapshot() {
    return this.revision;
  }
  get dirty() {
    return this.revision !== this.savedRevision;
  }
  acknowledge(revision: number) {
    this.savedRevision = Math.max(
      this.savedRevision,
      Math.min(revision, this.revision),
    );
    return !this.dirty;
  }
  reset() {
    this.revision = 0;
    this.savedRevision = 0;
  }
}
/** 块数量不能代表空文档：一个段落、附件或嵌套表格同样需要覆盖确认。 */
export function hasDocumentContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasDocumentContent);
  if (!value || typeof value !== "object") return false;
  const block = value as Record<string, unknown>;
  if (typeof block.text === "string" && block.text.trim()) return true;
  if (
    block.type &&
    ![
      "paragraph",
      "heading",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
      "text",
    ].includes(String(block.type))
  )
    return true;
  return (
    hasDocumentContent(block.content) ||
    hasDocumentContent(block.children) ||
    hasDocumentContent(block.rows) ||
    hasDocumentContent(block.cells)
  );
}
