import { normalizePath } from "./save";
import { useEffect, useId, useRef, useState } from "react";
import { Modal, Notice } from "../../components/shared/ui";
import { clientLog } from "../log/client";
import { OBSIDIAN_LOCAL_DEFAULTS } from "../config/limits";
import {
  presetSchema,
  type DirectoryHandle,
  type PresetRecord,
} from "./contracts";
import {
  deletePreset,
  isDirectoryPickerSupported,
  listPresets,
  pickDirectory,
  putPreset,
  verifyVault,
} from "./presets";

/** 预设及目录授权只存当前浏览器，不参与站点设置 PATCH。 */
export default function ObsidianSettings() {
  const noteDirectoryId = useId();
  const [records, setRecords] = useState<PresetRecord[]>([]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState<DirectoryHandle>();
  const [isVault, setIsVault] = useState(false);
  const [noteDirectory, setNoteDirectory] = useState<string>(
    OBSIDIAN_LOCAL_DEFAULTS.noteDirectory,
  );
  const [imageRule, setImageRule] = useState<string>(
    OBSIDIAN_LOCAL_DEFAULTS.imageRule,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rootStatus, setRootStatus] = useState<
    "unchecked" | "checking" | "valid" | "invalid"
  >("unchecked");
  const [rootError, setRootError] = useState<{
    message: string;
    retained: boolean;
  }>();
  const [pending, setPending] = useState<PresetRecord>();
  const lock = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  function fail(error: unknown) {
    clientLog("warn", "obsidian_local.presets_failed", {
      reason: error instanceof DOMException ? error.name : "operation_failed",
    });
    setError(error instanceof Error ? error.message : "本地预设操作失败。");
  }
  useEffect(() => {
    mounted.current = true;
    const sequence = revision.current;
    if (isDirectoryPickerSupported())
      void listPresets().then(
        (rows) => {
          if (mounted.current && revision.current === sequence)
            setRecords(rows);
        },
        (error) => {
          if (mounted.current) fail(error);
        },
      );
    return () => {
      mounted.current = false;
    };
  }, []);
  function reset() {
    revision.current++;
    setRootStatus("unchecked");
    setRootError(undefined);
    setId("");
    setName("");
    setHandle(undefined);
    setIsVault(false);
    setNoteDirectory(OBSIDIAN_LOCAL_DEFAULTS.noteDirectory);
    setImageRule(OBSIDIAN_LOCAL_DEFAULTS.imageRule);
    setError("");
    setMessage("");
  }
  async function edit(record: PresetRecord) {
    if (lock.current) return;
    const sequence = ++revision.current;
    lock.current = true;
    setBusy(true);
    setRootStatus("checking");
    setRootError(undefined);
    setId(record.preset.id);
    setName(record.preset.name);
    setHandle(record.handle);
    setIsVault(record.preset.isVault);
    setNoteDirectory(record.preset.noteDirectory);
    setImageRule(record.preset.imageRule);
    setError("");
    setMessage("");
    try {
      const valid = await verifyVault(record.handle);
      if (!mounted.current || revision.current !== sequence) return;
      setRootStatus(valid ? "valid" : "invalid");
      setIsVault(valid);
      if (!valid)
        setRootError({
          message: "当前路径没有检测到 Obsidian 仓库，请重新选择",
          retained: true,
        });
    } catch (error) {
      if (!mounted.current || revision.current !== sequence) return;
      setRootStatus("invalid");
      setRootError({
        message: error instanceof Error ? error.message : "本地预设操作失败。",
        retained: true,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function browse() {
    if (lock.current) return;
    setRootError(undefined);
    setMessage("");
    revision.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const chosen = await pickDirectory("documents");
      setRootStatus("checking");
      const vault = await verifyVault(chosen);
      // 根目录选择先校验再提交本地状态，拒绝时保留原有效选择。
      if (!vault)
        throw new Error("当前路径没有检测到 Obsidian 仓库，请重新选择");
      setRootStatus("valid");
      setHandle(chosen);
      setIsVault(vault);
      if (!name) setName(chosen.name);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        setMessage("已取消目录选择，原预设未改变。");
      else {
        setRootStatus("invalid");
        // 根选择错误紧贴路径反馈，避免保留旧路径被误解为接受了本次选择。
        setRootError({
          message:
            error instanceof Error ? error.message : "本地预设操作失败。",
          retained: Boolean(handle),
        });
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function browseNoteDirectory() {
    if (!handle || lock.current) return;
    revision.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const chosen = await pickDirectory(handle);
      if (!handle.resolve)
        throw new Error("浏览器不能验证子目录，请重新选择根目录。");
      const path = await handle.resolve(chosen);
      if (!path) throw new Error("文章目录必须位于已授权根目录内。");
      const relative = normalizePath(...path);
      // 子目录无需仓库标记；仍检查图片规则不会越过授权根。
      normalizePath(relative, imageRule);
      setNoteDirectory(relative);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        setMessage("已取消目录选择，原文章子目录未改变。");
      else fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function prepareSave() {
    if (!handle || lock.current || rootStatus !== "valid") return;
    setError("");
    setMessage("");
    const parsed = presetSchema.safeParse({
      // 兼容保留旧版本存下的字段，不再要求用户编辑或确认它们。
      ...records.find((record) => record.preset.id === id)?.preset,
      id: id || crypto.randomUUID(),
      name,
      vaultName: handle.name,
      noteDirectory,
      imageRule,
      isVault,
    });
    if (!parsed.success) {
      fail(
        new Error(parsed.error.issues.map((issue) => issue.message).join("；")),
      );
      return;
    }
    // 站内确认固定这份配置快照；不是文件系统授权，不接触 vault 文件。
    setPending({ preset: parsed.data, handle });
  }
  async function save() {
    if (!pending || lock.current) return;
    revision.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Browse 的旧结果不能授权这次保存：历史预设或目录标记可能已经变化。
      // 只读取直属配置目录，不请求文件写权限，验证失败不触碰 IndexedDB。
      setRootStatus("checking");
      try {
        if (!(await verifyVault(pending.handle)))
          throw new Error("当前路径没有检测到 Obsidian 仓库，请重新选择");
        setRootStatus("valid");
        setRootError(undefined);
      } catch (error) {
        setRootStatus("invalid");
        setRootError({
          message:
            error instanceof Error ? error.message : "本地预设操作失败。",
          retained: true,
        });
        throw error;
      }
      await putPreset({ ...pending.preset, isVault: true }, pending.handle);
      setRecords(await listPresets());
      setId(pending.preset.id);
      setPending(undefined);
      setMessage("本地预设已保存，仅此浏览器可用。");
    } catch (error) {
      fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove(record: PresetRecord) {
    if (lock.current) return;
    revision.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await deletePreset(record.preset.id);
      setRecords(await listPresets());
      if (id === record.preset.id) reset();
      setMessage("预设已删除，不会删除本地文章或图片。");
    } catch (error) {
      fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="obsidian-settings">
      <div className="section-heading">
        <h2>同步 Obsidian</h2>
        <p>手动保存当前文章与图片到本机，不自动同步。</p>
      </div>
      <p className="form-hint">
        目录授权与预设仅保存在此浏览器，不会上传；换设备后需重新选择。
      </p>
      {error && !pending && !rootError && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      {!isDirectoryPickerSupported() ? (
        <Notice>
          当前浏览器不支持本地目录授权。文章编辑器仍可普通下载
          Markdown，但不代表图片已落盘或已同步 Obsidian。
        </Notice>
      ) : (
        <div className="form-stack">
          <div className="field-heading">
            <h3>本地预设</h3>
            <button
              className="button small"
              type="button"
              disabled={busy}
              onClick={reset}
            >
              新增预设
            </button>
          </div>
          {records.map((record) => (
            <div
              className="config-card obsidian-preset-row"
              key={record.preset.id}
            >
              <div className="obsidian-preset-summary">
                <strong>{record.preset.name}</strong>
                <p className="form-hint">
                  {record.preset.vaultName}/{record.preset.noteDirectory}
                </p>
              </div>
              <div className="button-group">
                <button
                  className="button small"
                  type="button"
                  disabled={busy}
                  onClick={() => edit(record)}
                >
                  编辑 {record.preset.name}
                </button>
                <button
                  className="button small"
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(record)}
                >
                  删除 {record.preset.name}
                </button>
              </div>
            </div>
          ))}
          {/* 沿用设置表单布局，不使用会带浏览器默认边框的 fieldset/legend。 */}
          <div
            className="obsidian-preset-editor"
            role="group"
            aria-label={id ? "编辑预设" : "新增本地预设"}
            aria-busy={busy}
          >
            <div className="field-heading">
              <h3>{id ? "编辑预设" : "新增本地预设"}</h3>
            </div>
            <label>
              预设名称
              <input
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="obsidian-root-group">
              <div className="field-heading button-group">
                <span className="form-hint">
                  根目录：{handle?.name ?? "尚未授权"}
                </span>
                <button
                  className="button small"
                  type="button"
                  disabled={busy}
                  onClick={() => void browse()}
                >
                  浏览选择 vault 根目录
                </button>
              </div>
              {rootStatus === "checking" && (
                <p className="form-hint" role="status">
                  校验中…
                </p>
              )}
              {rootStatus === "valid" && (
                <p className="form-hint" role="status">
                  根目录存在 .obsidian 目录，校验通过。
                </p>
              )}
              {rootError && !pending && (
                <Notice kind="error">{rootError.message}</Notice>
              )}
            </div>
            <div className="form-grid">
              <div>
                <label htmlFor={noteDirectoryId}>默认文章子目录</label>
                <div className="button-group obsidian-directory-control">
                  <input
                    id={noteDirectoryId}
                    disabled={busy}
                    readOnly
                    value={noteDirectory}
                  />
                  <button
                    className="button small"
                    type="button"
                    disabled={busy || !handle}
                    onClick={() => void browseNoteDirectory()}
                  >
                    选择目录
                  </button>
                </div>
              </div>
              <label>
                图片规则（相对文章目录）
                <input
                  disabled={busy}
                  value={imageRule}
                  onChange={(event) => setImageRule(event.target.value)}
                />
              </label>
            </div>
            <p className="form-hint">
              默认图片放在根目录
              asset；路径不得越出仓库。缺失目录会在保存文章时确认创建。
            </p>
            <div className="button-group obsidian-preset-actions">
              <button
                className="button primary"
                type="button"
                disabled={busy || !handle || rootStatus !== "valid"}
                onClick={prepareSave}
              >
                保存本地预设
              </button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <Modal
          title="是否保存此预设？"
          onClose={() => {
            if (!lock.current) setPending(undefined);
          }}
        >
          <p className="form-hint">
            只保存当前浏览器中的配置，不写入文章或图片，也不申请目录写入权限。
          </p>
          <p>
            预设名称：<strong>{pending.preset.name}</strong>
          </p>
          <p>根目录：{pending.handle.name}</p>
          <p>文章子目录：{pending.preset.noteDirectory || "（根目录）"}</p>
          <p>图片规则：{pending.preset.imageRule}</p>
          {error && <Notice kind="error">{error}</Notice>}
          <div className="modal-actions button-group">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => setPending(undefined)}
            >
              取消
            </button>
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => void save()}
            >
              确认保存预设
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
