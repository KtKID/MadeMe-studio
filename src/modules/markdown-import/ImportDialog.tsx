import type { PresetImportSource } from "./preset-import";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, FolderOpen, Link2, X } from "lucide-react";
import { throwIfAborted } from "../../shared/request-cancellation";
import { Modal, Notice, Busy } from "../../components/shared/ui";
import {
  inspectAttachments,
  prepareAttachments,
  type Attachment,
  type AttachmentCache,
  type UploadedAttachment,
  type ResolveOptions,
} from "./attachments";
import { appendSelectedAttachments, referenceDetails } from "./selection";
import { clientCaught } from "../log/client";
import "./import-dialog.css";

export default function MarkdownImportDialog({
  source,
  onClose,
  upload,
  apply,
}: {
  source: { file: File; markdown: string; preset?: PresetImportSource };
  onClose: () => void;
  upload: (file: File, signal?: AbortSignal) => Promise<UploadedAttachment>;
  apply: (
    prepared: Awaited<ReturnType<typeof prepareAttachments>>,
  ) => Promise<void>;
}) {
  const [assets, setAssets] = useState<Attachment[]>(
    source.preset?.assets ?? [],
  );
  const [options, setOptions] = useState<ResolveOptions>(
    source.preset?.resolve ?? { mode: "selected" },
  );
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [reading, setReading] = useState(false);
  const selection = useRef(0);
  const selectionQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSelections = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const selectionController = useRef<AbortController | null>(null);
  const cache = useRef<AttachmentCache>(new Map());
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacement = useRef<File | null>(null);
  const latestSource = useRef(source);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  latestSource.current = source;
  useEffect(() => {
    cache.current = new Map();
    assetsRef.current = source.preset?.assets ?? [];
    selectionQueue.current = Promise.resolve();
    pendingSelections.current = 0;
    setAssets(source.preset?.assets ?? []);
    setOptions(source.preset?.resolve ?? { mode: "selected" });
    setFolder("");
    setError("");
    setProgress("");
    setReading(false);
    return () => {
      selection.current++;
      selectionController.current?.abort();
      controller.current?.abort();
      controller.current = null;
    };
  }, [source]);
  const inspection = useMemo(() => {
    try {
      return {
        rows: inspectAttachments(source.markdown, assets, options),
        error: "",
      };
    } catch (e) {
      return {
        rows: [],
        error: e instanceof Error ? e.message : "无法识别文档中的附件",
      };
    }
  }, [source.markdown, assets, options]);
  const rows = inspection.rows;
  const local = rows.filter((row) => !row.hosted);
  const missing = local.filter((row) => row.problem);
  const ready = !inspection.error && !missing.length;
  const unique = [
    ...new Set(local.flatMap((row) => (row.asset ? [row.asset.file] : []))),
  ];
  const nextUpload = progress
    ? unique.find((file) => !cache.current.has(file))
    : undefined;
  const matchedFiles = new Set(unique);
  const otherSelected = assets.filter(
    (asset) => asset.explicit && !matchedFiles.has(asset.file),
  );
  const busy = !!progress || reading;
  const close = () => {
    selection.current++;
    selectionController.current?.abort();
    controller.current?.abort();
    onClose();
  };
  function commitAssets(next: Attachment[]) {
    assetsRef.current = next;
    setAssets(next);
  }
  function choose(files: File[], directory: boolean, target?: File) {
    if (!files.length) return Promise.resolve();
    const sequence = selection.current;
    pendingSelections.current++;
    setError("");
    setReading(true);
    // 连续选择按顺序合并，不能让较早的一次慢读取覆盖或丢掉下一次选择。
    const run = async () => {
      if (selection.current !== sequence || latestSource.current !== source)
        return;
      const operation = new AbortController();
      selectionController.current = operation;
      try {
        if (!directory) {
          const next = target
            ? assetsRef.current.map((asset) =>
                asset.file === target ? { ...asset, file: files[0] } : asset,
              )
            : await appendSelectedAttachments(
                source.markdown,
                assetsRef.current,
                files,
                operation.signal,
              );
          if (selection.current === sequence && latestSource.current === source)
            commitAssets(next);
          return;
        }
        const paths = files.map((file) => ({
          file,
          path: file.webkitRelativePath.split("/").slice(1).join("/"),
        }));
        const notes = paths.filter(
          (item) =>
            item.file.name === source.file.name &&
            item.file.size === source.file.size,
        );
        if (notes.length !== 1)
          throw new Error(
            "未能在文件夹中唯一找到这篇笔记。请选择包含这份 Markdown 和附件的文件夹。",
          );
        const contents = await notes[0].file.text();
        throwIfAborted(operation.signal);
        if (selection.current !== sequence || latestSource.current !== source)
          return;
        if (contents !== source.markdown)
          throw new Error(
            "文件夹里的笔记内容与当前文档不同，请选择原笔记所在的文件夹。",
          );
        setOptions({ mode: "root", documentPath: notes[0].path });
        commitAssets([
          ...assetsRef.current.filter((asset) => asset.explicit),
          ...paths.filter((item) => item !== notes[0]),
        ]);
        setFolder(files[0].webkitRelativePath.split("/")[0]);
      } catch (e) {
        if (
          !operation.signal.aborted &&
          selection.current === sequence &&
          latestSource.current === source
        ) {
          clientCaught("editor.attachment_selection_failed", e);
          setError(
            e instanceof Error ? e.message : "读取附件失败，已保留之前的选择。",
          );
        }
      } finally {
        if (selection.current === sequence && latestSource.current === source) {
          pendingSelections.current--;
          setReading(pendingSelections.current > 0);
        }
      }
    };
    const task = selectionQueue.current.then(run, run);
    selectionQueue.current = task;
    return task;
  }
  function remove(file: File) {
    selection.current++;
    commitAssets(assetsRef.current.filter((asset) => asset.file !== file));
    setError("");
  }
  function replace(file: File) {
    replacement.current = file;
    replaceInput.current?.click();
  }
  async function confirm() {
    if (controller.current || !ready || reading) return;
    const operation = new AbortController();
    controller.current = operation;
    setError("");
    setProgress("正在准备导入…");
    try {
      const prepared = await prepareAttachments(
        source.markdown,
        assets,
        options,
        upload,
        {
          signal: operation.signal,
          cache: cache.current,
          readFile: source.preset?.readAttachment,
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
      if (latestSource.current === source) onClose();
    } catch (e) {
      if (!operation.signal.aborted && latestSource.current === source) {
        clientCaught("editor.attachment_import_failed", e);
        setError(
          `导入未完成，当前正文已保留：${e instanceof Error ? e.message : "附件处理失败，请重试。"}`,
        );
      }
    } finally {
      if (controller.current === operation) {
        controller.current = null;
        setProgress("");
      }
    }
  }
  function controls(asset: Attachment) {
    return (
      <span className="import-file-actions">
        <button
          type="button"
          className="import-text-button"
          disabled={busy}
          aria-label={`替换 ${asset.file.name}`}
          onClick={() => replace(asset.file)}
        >
          替换
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={`移除 ${asset.file.name}`}
          onClick={() => remove(asset.file)}
        >
          <X size={15} />
        </button>
      </span>
    );
  }
  return (
    <Modal title="导入 Markdown 与附件" onClose={close}>
      <div className="markdown-import">
        <div className="import-document">
          <FileText size={22} />
          <div>
            <strong>{source.file.name}</strong>
            <span>
              正文已读取 ·{" "}
              {inspection.error
                ? "附件预检未通过"
                : `已识别 ${rows.length} 处附件引用`}
            </span>
          </div>
        </div>
        {source.preset && (
          <p className="form-hint">
            笔记预设：{source.preset.name}
            <br />
            文章路径：{source.preset.documentPath}
          </p>
        )}
        <p className="import-intro">
          {source.preset
            ? "已从笔记预设自动匹配附件；只上传这篇文章的引用文件，远程链接保留。"
            : inspection.error
              ? "请检查附件写法，当前正文尚未改变。"
              : rows.length
                ? "链接会自动保留。本地附件添加后会自动匹配，只上传本文引用的文件。"
                : "没有需要上传的附件，可以直接导入正文。"}
        </p>
        <input
          hidden
          ref={filesInput}
          aria-label="选择附件文件"
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void choose(files, false);
          }}
        />
        <input
          hidden
          ref={replaceInput}
          aria-label="替换已选附件"
          type="file"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            const target = replacement.current;
            replacement.current = null;
            if (files.length && target) void choose(files, false, target);
          }}
        />
        <input
          hidden
          ref={folderInput}
          aria-label="选择共同上级文件夹"
          type="file"
          multiple
          {...{ webkitdirectory: "" }}
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void choose(files, true);
          }}
        />
        {inspection.error && <Notice kind="error">{inspection.error}</Notice>}
        {!!rows.length && (
          <section className="import-manifest" aria-label="附件清单">
            <div className="import-section-heading">
              <strong>本次附件</strong>
              <span>
                {missing.length
                  ? `${missing.length} 处待补充`
                  : `${unique.length} 个文件上传 · ${rows.filter((row) => row.hosted).length} 个链接保留`}
              </span>
            </div>
            <ul className="import-attachment-list">
              {rows.map((row, index) => {
                const info = referenceDetails(row.ref),
                  uploaded = !!row.asset && cache.current.has(row.asset.file);
                const status = row.hosted
                  ? "保留链接"
                  : row.problem
                    ? /同名|歧义/.test(row.problem)
                      ? "同名待确认"
                      : source.preset
                        ? "预设中缺失"
                        : "待添加"
                    : uploaded
                      ? "已上传"
                      : progress
                        ? row.asset?.file === nextUpload
                          ? "上传中"
                          : "等待上传"
                        : "已匹配";
                return (
                  <li
                    key={index}
                    data-source={row.hosted ? "hosted" : "local"}
                    data-matched={!!row.asset}
                  >
                    <div className="import-file-main">
                      {row.hosted ? (
                        <Link2 size={17} />
                      ) : row.asset ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <FileText size={17} />
                      )}
                      <div>
                        <strong title={row.ref.target}>{info.name}</strong>
                        <span>
                          {info.type} · {info.source}
                          {row.asset && row.asset.file.name !== info.name
                            ? ` · 已选择 ${row.asset.file.name}`
                            : ""}
                        </span>
                        {source.preset && !row.hosted && (
                          <small className="import-reference-path">
                            {row.asset?.path ?? row.ref.target}
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="import-file-end">
                      <span
                        className={`import-status ${row.problem ? "needs-file" : ""}`}
                      >
                        {status}
                      </span>
                      {row.asset && !source.preset && controls(row.asset)}
                    </div>
                    {row.problem && assets.length > 0 && (
                      <small className="import-file-problem">
                        {row.problem}
                      </small>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {!!otherSelected.length && (
          <section className="import-other-files" aria-label="其他已选文件">
            <strong>其他已选文件</strong>
            <small>未匹配的文件不会上传。同名文件请保留需要的一份。</small>
            <ul>
              {otherSelected.map((asset, index) => (
                <li key={index}>
                  <span>
                    {asset.file.name} <small>（文件 {index + 1}）</small>
                  </span>
                  {controls(asset)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {!source.preset && !!local.length && (
          <details className="import-folder-option">
            <summary>附件较多？从文件夹自动匹配</summary>
            <p>选择包含这篇笔记和附件的笔记库文件夹；只读取引用附件。</p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => folderInput.current?.click()}
            >
              <FolderOpen size={15} />
              选择笔记库文件夹
            </button>
            {folder && (
              <span className="import-folder-name">
                {folder}
                <button
                  type="button"
                  className="import-text-button"
                  disabled={busy}
                  onClick={() => {
                    setAssets((current) =>
                      current.filter((asset) => asset.explicit),
                    );
                    setOptions({ mode: "selected" });
                    setFolder("");
                    setError("");
                  }}
                >
                  移除文件夹
                </button>
              </span>
            )}
          </details>
        )}
        {missing.length > 0 && (
          <p className="import-guidance">
            {source.preset
              ? `预设中还有 ${missing.length} 处引用未匹配，请检查仓库文件和笔记路径后重新选择文章。当前正文尚未改变。`
              : `还有 ${missing.length} 处本地附件待添加。可以一次多选，也可以分次添加；之前的选择会保留。`}
          </p>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <p className="import-footnote">
          导入会替换当前正文，确认后再保存草稿。取消不改正文，已上传文件保留在媒体库。
        </p>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {progress ? "取消导入" : "取消"}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!!inspection.error || busy || (!!source.preset && !ready)}
            onClick={() =>
              ready ? void confirm() : filesInput.current?.click()
            }
          >
            {progress ? (
              <Busy text={progress} />
            ) : reading ? (
              <Busy text="正在匹配…" />
            ) : inspection.error ? (
              "无法导入"
            ) : ready ? (
              local.length ? (
                "上传附件并导入"
              ) : (
                "导入正文"
              )
            ) : source.preset ? (
              "附件未匹配，无法导入"
            ) : (
              "补充缺失附件"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
