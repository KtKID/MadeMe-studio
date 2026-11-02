import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Modal, Notice, Busy } from "../../components/shared/ui";
import { clientLog } from "../log/client";
import {
  getRepository,
  subscribeRepositoryChanges,
  assertRepositoryCurrent,
  checkRepositoryRead,
  authorizeRepositoryRead,
  RepositoryReadPermissionError,
  type RepositoryConnection,
} from "../obsidian-repository/connection";
import {
  pickRepositoryMarkdown,
  readConnectedMarkdown,
  supportsRepositoryFilePicker,
  type MarkdownImportTicket,
  type RepositoryMarkdown,
} from "./repository-import";

/** 导入只读独立仓库连接，不查询或继承导出预设。 */
export default function RepositoryImportButton({
  maxBytes,
  onBegin,
  onChosen,
  onManual,
}: {
  maxBytes: number;
  onBegin: () => MarkdownImportTicket | null;
  onChosen: (
    source: RepositoryMarkdown,
    ticket: MarkdownImportTicket,
  ) => Promise<void>;
  onManual: () => void;
}) {
  const [open, setOpen] = useState(false),
    [connection, setConnection] = useState<RepositoryConnection>();
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [needsPermission, setNeedsPermission] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    locked = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(
    () =>
      subscribeRepositoryChanges(() => {
        generation.current++;
        controller.current?.abort();
        locked.current = false;
        setBusy(false);
        setOpen(false);
        setConnection(undefined);
        onBegin();
      }),
    [],
  );
  function log(event: string, e: unknown) {
    clientLog("warn", event, {
      reason: e instanceof DOMException ? e.name : "operation_failed",
    });
  }
  function close() {
    generation.current++;
    controller.current?.abort();
    locked.current = false;
    setBusy(false);
    setOpen(false);
  }
  async function show() {
    controller.current?.abort();
    locked.current = false;
    setBusy(false);
    onBegin();
    const current = ++generation.current;
    setOpen(true);
    setConnection(undefined);
    setNeedsPermission(false);
    setError("");
    setLoading(true);
    try {
      const found = await getRepository();
      if (current === generation.current) setConnection(found);
    } catch (e) {
      if (current === generation.current) {
        log("editor.import_repository_failed", e);
        setError(e instanceof Error ? e.message : "无法读取仓库连接。");
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function choose(record: RepositoryConnection) {
    if (locked.current) return;
    const ticket = onBegin();
    if (!ticket) {
      setError("编辑器正忙，请稍后重试。");
      return;
    }
    const current = ++generation.current,
      operation = new AbortController();
    controller.current?.abort();
    controller.current = operation;
    locked.current = true;
    setBusy(true);
    setError("");
    setNeedsPermission(false);
    try {
      await assertRepositoryCurrent(record);
      await checkRepositoryRead(record);
      if (current !== generation.current) return;
      const handles = await pickRepositoryMarkdown(record);
      if (current !== generation.current || !handles[0]) return;
      const source = await readConnectedMarkdown(
        record,
        handles[0],
        maxBytes,
        operation.signal,
      );
      if (current !== generation.current) return;
      await assertRepositoryCurrent(record);
      await onChosen(source, ticket);
      if (current === generation.current) setOpen(false);
    } catch (e) {
      if (current === generation.current && !operation.signal.aborted) {
        if (
          (e instanceof Error || e instanceof DOMException) &&
          e.name === "AbortError"
        )
          setError("已取消选择文章，原文没有改变。");
        else {
          log("editor.repository_import_failed", e);
          setError(
            e instanceof Error ? e.message : "从仓库读取失败，原文已保留。",
          );
          setNeedsPermission(e instanceof RepositoryReadPermissionError);
        }
      }
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function authorize(record: RepositoryConnection) {
    if (locked.current) return;
    const current = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await authorizeRepositoryRead(record);
      if (current === generation.current) setNeedsPermission(false);
    } catch (e) {
      if (current === generation.current) {
        log("editor.import_read_permission_failed", e);
        setError(e instanceof Error ? e.message : "读取授权未完成。");
      }
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  const supported = supportsRepositoryFilePicker();
  return (
    <>
      <button type="button" onClick={() => void show()}>
        <FileUp size={14} />
        导入
      </button>
      {open && (
        <Modal title="从 Obsidian 仓库导入" onClose={close}>
          <p>
            选择一篇
            Markdown，自动读取它引用的图片、视频与动图。导入仓库独立于笔记导出预设。
          </p>
          {loading ? (
            <Busy text="读取仓库连接…" />
          ) : !supported ? (
            <Notice>
              此浏览器不支持原生文件句柄选择，请使用支持本机文件访问的桌面浏览器。
            </Notice>
          ) : !connection ? (
            <Notice>
              尚未连接 Obsidian 仓库。请先在后台“Obsidian
              仓库”选择目录；不会自动使用笔记导出预设。
            </Notice>
          ) : (
            <div className="config-card">
              <strong>{connection.name}</strong>
              <p className="form-hint">仅导入使用 · 当前浏览器与域名</p>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void choose(connection)}
              >
                选择 Markdown 文章
              </button>
            </div>
          )}
          {busy && <Busy text="正在读取文章及引用附件…" />}
          {error && (
            <Notice kind={needsPermission ? "info" : "error"}>{error}</Notice>
          )}
          {needsPermission && connection && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void authorize(connection)}
            >
              重新授权仓库（只读）
            </button>
          )}
          <p className="form-hint">
            不修改本地文件、不上传整库。正式博客与测试 Site
            的仓库连接不能跨域名继承。
          </p>
          <div className="modal-actions">
            <a className="button" href="/studio/settings#obsidian-repository">
              设置 Obsidian 仓库
            </a>
            <button type="button" className="button" onClick={close}>
              取消
            </button>
          </div>
          {(!connection || !supported) && !loading && (
            <button
              type="button"
              className="import-text-button"
              onClick={() => {
                close();
                onManual();
              }}
            >
              仅选择单个文件（不自动读取本地附件）
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
