import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

// 该组件仅验证真实编辑器集成；持久化由后续内容模块提供。
export default function FoundationEditor() {
  const editor = useCreateBlockNote({
    initialContent: [{ type: "paragraph", content: "开始记录你的想法。" }],
  });
  return (
    <section aria-label="BlockNote 基础编辑器">
      <BlockNoteView editor={editor} theme="light" />
    </section>
  );
}
