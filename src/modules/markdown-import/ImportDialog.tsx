import { useEffect, useMemo, useRef, useState } from "react";
import { throwIfAborted } from "../../shared/request-cancellation";
import { Modal, Notice, Busy } from "../../components/shared/ui";
import {
  attachmentPlan,
  mediaReferences,
  isHostedMedia,
  prepareAttachments,
  type Attachment,
  type AttachmentCache,
  type UploadedAttachment,
  type ResolveOptions,
} from "./attachments";
import { clientCaught } from "../log/client";

export default function MarkdownImportDialog({
  source,
  onClose,
  upload,
  apply,
}: {
  source: { file: File; markdown: string };
  onClose: () => void;
  upload: (file: File, signal?: AbortSignal) => Promise<UploadedAttachment>;
  apply: (
    prepared: Awaited<ReturnType<typeof prepareAttachments>>,
  ) => Promise<void>;
}) {
  const [assets, setAssets] = useState<Attachment[]>([]);
  const [options, setOptions] = useState<ResolveOptions>({ mode: "selected" });
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [reading, setReading] = useState(false);
  const selection = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const cache = useRef<AttachmentCache>(new Map());
  const latestSource = useRef(source);
  latestSource.current = source;
  useEffect(() => {
    cache.current = new Map();
    setAssets([]);
    setOptions({ mode: "selected" });
    setError("");
    setProgress("");
    setReading(false);
    return () => {
      selection.current++;
      controller.current?.abort();
      controller.current = null;
    };
  }, [source]);
  const analysis = useMemo(() => {
    try {
      return {
        count: mediaReferences(source.markdown).filter(
          (ref) => !isHostedMedia(ref.target),
        ).length,
        error: "",
      };
    } catch (e) {
      return { count: 0, error: (e as Error).message };
    }
  }, [source.markdown]);
  const problem = useMemo(() => {
    if (analysis.error) return analysis.error;
    try {
      attachmentPlan(source.markdown, assets, options);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  }, [source.markdown, assets, options, analysis.error]);
  const count = analysis.count;
  const close = () => {
    selection.current++;
    controller.current?.abort();
    onClose();
  };
  async function choose(files: File[], directory: boolean) {
    const sequence = ++selection.current;
    setError("");
    if (!directory) {
      setAssets(files.map((file) => ({ file, path: file.name })));
      setOptions({ mode: "selected" });
      return;
    }
    // 浏览器仅提供用户选中文件夹的 File 列表；不读取目录外的任何路径。
    setReading(true);
    setAssets([]);
    try {
      const paths = files.map((file) => ({
        file,
        path: file.webkitRelativePath.split("/").slice(1).join("/"),
      }));
      const notes = paths.filter(
        (item) =>
          item.file.name === source.file.name &&
          item.file.size === source.file.size,
      );
      if (notes.length !== 1) {
        setAssets([]);
        setError(
          "所选目录中无法唯一定位这份 Markdown。请选择包含原笔记和附件的共同上级目录，或改用“选择附件文件”。",
        );
        return;
      }
      const contents = await notes[0].file.text();
      if (selection.current !== sequence || latestSource.current !== source)
        return;
      if (contents !== source.markdown) {
        setAssets([]);
        setError(
          "目录中的同名 Markdown 与已选择的内容不同，请重新选择原文件或补选附件。",
        );
        return;
      }
      setOptions({ mode: "root", documentPath: notes[0].path });
      setAssets(paths.filter((item) => item !== notes[0]));
    } catch (e) {
      if (selection.current === sequence && latestSource.current === source) {
        clientCaught("editor.attachment_directory_failed", e);
        setError("无法读取所选目录，请重新选择或改用附件多选。");
      }
    } finally {
      if (selection.current === sequence && latestSource.current === source)
        setReading(false);
    }
  }
  async function confirm() {
    if (controller.current || problem || reading) return;
    const operation = new AbortController();
    controller.current = operation;
    setError("");
    setProgress("正在检查并上传引用附件…");
    try {
      const prepared = await prepareAttachments(
        source.markdown,
        assets,
        options,
        upload,
        {
          signal: operation.signal,
          cache: cache.current,
          progress: (done, total) => {
            if (
              latestSource.current === source &&
              controller.current === operation
            )
              setProgress(`已上传 ${done} / ${total} 个附件`);
          },
        },
      );
      throwIfAborted(operation.signal);
      if (latestSource.current !== source) return;
      await apply(prepared);
      throwIfAborted(operation.signal);
      if (latestSource.current !== source) return;
      onClose();
    } catch (e) {
      if (!operation.signal.aborted && latestSource.current === source) {
        clientCaught("editor.attachment_import_failed", e);
        setError(`导入未完成，当前正文已保留：${(e as Error).message}`);
      }
    } finally {
      if (controller.current === operation) {
        controller.current = null;
        setProgress("");
      }
    }
  }
  return (
    <Modal title="导入 Markdown 与附件" onClose={close}>
      <p>
        {source.file.name} · {count}{" "}
        处本地附件引用。导入成功后将替换当前正文，请检查后再保存草稿。
      </p>
      <p>
        浏览器不能自动读取 Markdown
        旁边的文件。请选择引用附件；同名文件或复杂目录请选包含笔记与附件的共同上级文件夹。只上传正文实际引用的图片、视频、音频或
        PDF，不上传其它笔记。
      </p>
      <label>
        选择附件文件
        <input
          aria-label="选择附件文件"
          type="file"
          multiple
          disabled={!!progress || reading}
          onChange={(e) => choose(Array.from(e.target.files || []), false)}
        />
      </label>
      <label>
        选择共同上级文件夹
        <input
          aria-label="选择共同上级文件夹"
          type="file"
          multiple
          {...{ webkitdirectory: "" }}
          disabled={!!progress || reading}
          onChange={(e) => choose(Array.from(e.target.files || []), true)}
        />
      </label>
      {problem && <Notice>{problem}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <small>
        取消或失败不会替换正文。已经传到媒体库的文件会保留；重试会复用本次已完成的上传。GIF
        保留动画；MOV 是否可播放取决于浏览器和视频编码。
      </small>
      <div className="form-actions">
        <button onClick={close}>{progress ? "取消导入" : "取消"}</button>
        <button
          className="primary"
          disabled={!!problem || !!progress || reading}
          onClick={() => void confirm()}
        >
          {progress ? <Busy text={progress} /> : "上传附件并导入"}
        </button>
      </div>
    </Modal>
  );
}
