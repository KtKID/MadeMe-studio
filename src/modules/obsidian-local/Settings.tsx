import { useEffect, useRef, useState } from "react";
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
  const [records, setRecords] = useState<PresetRecord[]>([]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState<DirectoryHandle>();
  const [isVault, setIsVault] = useState(false);
  const [obsidianVault, setObsidianVault] = useState("");
  const [vaultRootConfirmed, setVaultRootConfirmed] = useState(false);
  const [noteDirectory, setNoteDirectory] = useState<string>(
    OBSIDIAN_LOCAL_DEFAULTS.noteDirectory,
  );
  const [imageRule, setImageRule] = useState<string>(
    OBSIDIAN_LOCAL_DEFAULTS.imageRule,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
    setId("");
    setName("");
    setHandle(undefined);
    setIsVault(false);
    setObsidianVault("");
    setVaultRootConfirmed(false);
    setNoteDirectory(OBSIDIAN_LOCAL_DEFAULTS.noteDirectory);
    setImageRule(OBSIDIAN_LOCAL_DEFAULTS.imageRule);
    setError("");
    setMessage("");
  }
  function edit(record: PresetRecord) {
    setId(record.preset.id);
    setName(record.preset.name);
    setHandle(record.handle);
    setIsVault(record.preset.isVault);
    setObsidianVault(record.preset.obsidianVault ?? "");
    setVaultRootConfirmed(record.preset.vaultRootConfirmed ?? false);
    setNoteDirectory(record.preset.noteDirectory);
    setImageRule(record.preset.imageRule);
    setError("");
    setMessage("");
  }
  async function browse() {
    if (lock.current) return;
    revision.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const chosen = await pickDirectory("documents");
      const vault = await verifyVault(chosen);
      setHandle(chosen);
      setVaultRootConfirmed(false); // 更换目录后必须重新确认与登记仓库的对应关系。
      setIsVault(vault);
      if (!name) setName(chosen.name);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        setMessage("已取消目录选择，原预设未改变。");
      else fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function prepareSave() {
    if (!handle || lock.current) return;
    setError("");
    setMessage("");
    const parsed = presetSchema.safeParse({
      id: id || crypto.randomUUID(),
      name,
      vaultName: handle.name,
      noteDirectory,
      imageRule,
      isVault,
      obsidianVault,
      vaultRootConfirmed,
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
      await putPreset(pending.preset, pending.handle);
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
    <div>
      <div className="section-heading">
        <h2>同步 Obsidian</h2>
        <p>
          网站当前稿 → 本机 Markdown 与图片，需每次主动保存；不是后台双向同步。
        </p>
      </div>
      <p className="form-hint">
        目录授权与预设仅存此浏览器的
        IndexedDB，换设备或清除浏览器数据后需重新选择。不会上传目录句柄，也不能用手填绝对路径代替授权。
      </p>
      {error && <Notice kind="error">{error}</Notice>}
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
            <div className="config-card" key={record.preset.id}>
              <strong>{record.preset.name}</strong>
              <p className="form-hint">
                {record.preset.vaultName}/{record.preset.noteDirectory}
              </p>
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
            {handle && !isVault && (
              <Notice>
                未找到 .obsidian：这是普通文件夹，保存时不会显示为已同步
                Obsidian。请确认选择的是仓库根目录。
              </Notice>
            )}
            <label>
              Obsidian 已登记仓库名称或 ID（可选）
              <input
                disabled={busy}
                value={obsidianVault}
                onChange={(event) => {
                  setObsidianVault(event.target.value);
                  setVaultRootConfirmed(false);
                }}
              />
              <small className="form-hint">
                请填写 Obsidian 仓库切换器中的实际名称或复制的仓库
                ID，不是此处预设名称，也不自动采用文件夹名。留空仍可保存文件，但不生成打开链接。
              </small>
            </label>
            <div className="scope-options">
              <label>
                <input
                  type="checkbox"
                  disabled={busy || !isVault || !obsidianVault.trim()}
                  checked={vaultRootConfirmed}
                  onChange={(event) =>
                    setVaultRootConfirmed(event.target.checked)
                  }
                />
                我确认所选目录就是该 Obsidian 仓库根目录（不是父目录或子目录）
              </label>
            </div>
            <p className="form-hint">
              浏览器无法读取 Obsidian 的仓库登记信息；发现 .obsidian
              不能证明名称匹配。若选择的是父目录或子目录，请重新浏览选择真正的仓库根目录。
            </p>
            <div className="form-grid">
              <label>
                默认文章子目录
                <input
                  disabled={busy}
                  value={noteDirectory}
                  onChange={(event) => setNoteDirectory(event.target.value)}
                />
              </label>
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
              默认“笔记”与“../asset”会把图片放到根目录的
              asset；不得越过已授权根目录。不自动创建缺失目录，保存时会再次确认。
            </p>
            <div className="button-group">
              <button
                className="button primary"
                type="button"
                disabled={busy || !handle}
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
          <p>
            Obsidian 打开目标：
            {pending.preset.obsidianVault && pending.preset.vaultRootConfirmed
              ? pending.preset.obsidianVault
              : "未配置或未确认，不生成打开链接"}
          </p>
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
