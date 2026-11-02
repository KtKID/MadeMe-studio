import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Modal, Notice, Busy } from "../../components/shared/ui";
import Dropdown from "../../components/shared/Dropdown";
import { listPresets, type PresetRecord } from "../obsidian-local/presets";
import { clientLog } from "../log/client";
import {
  PresetReadPermissionError,
  authorizePresetRead,
  checkPresetRead,
  pickPresetMarkdown,
  readPresetMarkdown,
  supportsPresetFilePicker,
  type MarkdownImportTicket,
  type PresetMarkdown,
} from "./preset-import";

/** 复用当前origin的笔记预设；每次明确预设，不把导出的list[0]当导入确认。 */
function logFailure(event: string, error: unknown) {
  clientLog("warn", event, {
    reason: error instanceof DOMException ? error.name : "operation_failed",
  });
}
export default function PresetImportButton({
  maxBytes,
  onBegin,
  onChosen,
  onManual,
}: {
  maxBytes: number;
  onBegin: () => MarkdownImportTicket | null;
  onChosen: (
    source: PresetMarkdown,
    ticket: MarkdownImportTicket,
  ) => Promise<void>;
  onManual: () => void;
}) {
  const [open, setOpen] = useState(false),
    [records, setRecords] = useState<PresetRecord[]>([]),
    [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [permissionRecord, setPermissionRecord] = useState<PresetRecord>();
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
    onBegin(); // 立即使旧导入票据失效，取消打开新选择也不会应用旧回调。
    const current = ++generation.current;
    setOpen(true);
    setSelected("");
    setPermissionRecord(undefined);
    setError("");
    setLoading(true);
    try {
      const list = await listPresets();
      if (current === generation.current) setRecords(list);
    } catch (e) {
      if (current === generation.current) {
        logFailure("editor.import_presets_failed", e);
        setError(e instanceof Error ? e.message : "无法读取笔记预设");
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function choose(record: PresetRecord) {
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
    setPermissionRecord(undefined);
    try {
      await checkPresetRead(record);
      if (current !== generation.current) return;
      const handles = await pickPresetMarkdown(record);
      if (current !== generation.current || !handles[0]) return;
      const source = await readPresetMarkdown(
        record,
        handles[0],
        maxBytes,
        operation.signal,
      );
      if (current !== generation.current) return;
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
          logFailure("editor.preset_import_failed", e);
          setError(
            e instanceof Error ? e.message : "从笔记预设读取失败，原文已保留。",
          );
          if (e instanceof PresetReadPermissionError)
            setPermissionRecord(record);
        }
      }
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function authorize(record: PresetRecord) {
    if (locked.current) return;
    const current = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await authorizePresetRead(record);
      if (current === generation.current) {
        setPermissionRecord(undefined);
        setError("");
      }
    } catch (e) {
      if (current === generation.current) {
        logFailure("editor.import_read_permission_failed", e);
        setError(e instanceof Error ? e.message : "读取授权未完成。");
      }
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  const supported = supportsPresetFilePicker();
  const chosen = records.find((record) => record.preset.id === selected);
  return (
    <>
      <button type="button" onClick={() => void show()}>
        <FileUp size={14} />
        导入
      </button>
      {open && (
        <Modal title="从笔记预设导入" onClose={close}>
          <p>
            复用已有 Obsidian
            笔记预设。选择一篇文章后，自动读取这篇文章引用的图片、视频与动图。
          </p>
          {loading ? (
            <Busy text="读取笔记预设…" />
          ) : !supported ? (
            <Notice>
              此浏览器不支持从已关联目录选择文章。请使用支持本机文件访问的桌面浏览器。
            </Notice>
          ) : !records.length ? (
            <Notice>
              此站点尚未关联笔记预设。请先在“同步
              Obsidian”关联仓库；正式博客与测试 Site 的预设不能互相继承。
            </Notice>
          ) : records.length === 1 ? (
            <div className="config-card">
              <strong>{records[0].preset.name}</strong>
              <p className="form-hint">仓库：{records[0].preset.vaultName}</p>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void choose(records[0])}
              >
                选择 Markdown 文章
              </button>
            </div>
          ) : (
            <div className="form-stack">
              <Dropdown
                label="笔记预设"
                value={selected}
                options={[
                  { value: "", label: "请选择笔记预设", disabled: true },
                  ...records.map((record) => ({
                    value: record.preset.id,
                    label: record.preset.name + " · " + record.preset.vaultName,
                  })),
                ]}
                disabled={busy}
                onChange={(value) => {
                  setSelected(value);
                  setError("");
                  setPermissionRecord(undefined);
                }}
              />
              <button
                type="button"
                className="button primary"
                disabled={busy || !chosen}
                onClick={() => chosen && void choose(chosen)}
              >
                选择 Markdown 文章
              </button>
            </div>
          )}
          {busy && <Busy text="正在从预设读取…" />}
          {error && (
            <Notice kind={permissionRecord ? "info" : "error"}>{error}</Notice>
          )}
          {permissionRecord && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void authorize(permissionRecord)}
            >
              重新授权此预设（只读）
            </button>
          )}
          <p className="form-hint">
            不会修改本地笔记，也不会上传其他文章。预设及授权仅保存在当前站点和浏览器。
          </p>
          <div className="modal-actions">
            <a className="button" href="/studio/settings">
              打开笔记预设设置
            </a>
            <button type="button" className="button" onClick={close}>
              取消
            </button>
          </div>
          {(!records.length || !supported) && !loading && (
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
