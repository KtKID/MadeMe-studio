import { createPortal } from "react-dom";
import { resolveObsidianUri } from "./open";
import { useRef, useState } from "react";
import { Modal, Notice, downloadText } from "../../components/shared/ui";
import { clientLog } from "../log/client";
import { OBSIDIAN_LOCAL_DEFAULTS } from "../config/limits";
import type { ExportSnapshot, PreparedExport } from "../local-export/contracts";
import {
  prepareExport,
  replaceMarkdownMediaUrl,
} from "../local-export/prepare";
import type { PresetRecord } from "./contracts";
import {
  isDirectoryPickerSupported,
  listPresets,
  pickDirectory,
  verifyVault,
} from "./presets";
import {
  LocalConflictError,
  MissingDirectoryError,
  normalizePath,
  saveToDirectory,
} from "./save";

/** 点击时固定当前稿快照；保存到本机与网站保存/发布完全分离。 */
export default function SaveButton({
  getSnapshot,
}: {
  getSnapshot: () => ExportSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<PresetRecord[]>([]);
  const [selected, setSelected] = useState<PresetRecord>();
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [missing, setMissing] = useState(false);
  const [result, setResult] = useState<{
    path: string;
    openUri: string | null;
    isVault?: boolean;
  }>();
  const lock = useRef(false);
  const request = useRef(0);
  const snapshot = useRef<PreparedExport | null>(null);
  const supported = isDirectoryPickerSupported();
  function fail(error: unknown) {
    clientLog("warn", "obsidian_local.ui_failed", {
      reason: error instanceof DOMException ? error.name : "operation_failed",
    });
    setError(error instanceof Error ? error.message : "本地保存失败，请重试。");
  }
  function close() {
    if (!lock.current) {
      request.current++;
      setOpen(false);
      snapshot.current = null;
    }
  }
  async function show() {
    if (lock.current) return;
    setSelected(undefined);
    const generation = ++request.current;
    setOpen(true);
    setError("");
    setResult(undefined);
    setConflict(false);
    setMissing(false);
    snapshot.current = null;
    if (!supported) return;
    try {
      const list = await listPresets();
      if (request.current !== generation) return;
      setRecords(list);
      setSelected(list[0]);
      setDirectory(
        list[0]?.preset.noteDirectory ?? OBSIDIAN_LOCAL_DEFAULTS.noteDirectory,
      );
    } catch (error) {
      if (request.current === generation) fail(error);
    }
  }
  async function chooseOther() {
    if (lock.current) return;
    request.current++; // 用户手选目标优先于迟到的预设读取。
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const handle = await pickDirectory("documents");
      const isVault = await verifyVault(handle);
      // 根目录选择先校验再提交本地状态，拒绝时保留原有效选择。
      if (!isVault)
        throw new Error("这个路径没有检测到 Obsidian 仓库，请重新选择");
      const preset = {
        id: crypto.randomUUID(),
        name: handle.name,
        vaultName: handle.name,
        noteDirectory: OBSIDIAN_LOCAL_DEFAULTS.noteDirectory,
        imageRule: OBSIDIAN_LOCAL_DEFAULTS.imageRule,
        isVault,
      };
      setSelected({ handle, preset });
      setDirectory(preset.noteDirectory);
      setResult(undefined);
      setConflict(false);
      setMissing(false);
      snapshot.current = null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        setError("已取消选择，未保存文件。");
      else fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function chooseChild() {
    if (!selected || lock.current) return;
    request.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const chosen = await pickDirectory(selected.handle);
      if (!selected.handle.resolve)
        throw new Error("浏览器不能验证子目录，请重新选择根目录。");
      const path = await selected.handle.resolve(chosen);
      if (!path) throw new Error("文章目录必须位于已授权根目录内。");
      const relative = normalizePath(...path);
      normalizePath(relative, selected.preset.imageRule);
      setDirectory(relative);
      setResult(undefined);
      setConflict(false);
      setMissing(false);
      snapshot.current = null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        setError("已取消选择，未保存文件。");
      else fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(mode?: "copy" | "overwrite", createDirectories = false) {
    if (!selected || lock.current) return;
    request.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      // 快照转换是同步操作；先固定它，避免转换失败时留下未处理的权限 Promise。
      if ((!mode && !createDirectories) || !snapshot.current)
        snapshot.current = prepareExport(getSnapshot(), window.location.origin);
      // 查询不会弹窗；已授权直接继续，被拒绝则停止，不能自动反复请求。
      const permission =
        (await selected.handle.queryPermission?.({ mode: "readwrite" })) ??
        "prompt";
      if (permission === "denied")
        throw new Error(
          "目录写入权限已被拒绝，未保存文章。请在浏览器设置中调整权限，或主动选择其他位置。",
        );
      // 仅此实际保存点击路径可请求写权限；首次写入/授权过期仍可能出现系统确认。
      if (
        permission !== "granted" &&
        (await selected.handle.requestPermission?.({ mode: "readwrite" })) !==
          "granted"
      )
        throw new Error("目录权限已失效。请重新授权或选择其他位置；尚未保存。");
      const saved = await saveToDirectory(selected.handle, snapshot.current, {
        noteDirectory: directory,
        imageRule: selected.preset.imageRule,
        conflict: mode,
        createDirectories,
      });
      setConflict(false);
      setMissing(false);
      // 文件已成功提交，打开目标探测失败不能被描述成保存失败或普通目录。
      setResult({ path: saved.notePath, openUri: null });
      try {
        const openUri = await resolveObsidianUri(
          selected.handle,
          saved.notePath,
        );
        setResult({ path: saved.notePath, openUri, isVault: openUri !== null });
      } catch (error) {
        fail(error);
        setError(
          `文件已保存，但无法确认 Obsidian 打开目标：${error instanceof Error ? error.message : "目录读取失败"}`,
        );
      }
    } catch (error) {
      if (error instanceof LocalConflictError) {
        setConflict(true);
        setError(
          "本地文章已修改。请选择另存副本，或明确确认覆盖；取消会保留原稿。",
        );
      } else if (error instanceof MissingDirectoryError) {
        setMissing(true);
        setError(
          "目标目录不存在。请明确创建目录后保存，或选择其他位置；尚未保存文章。",
        );
      } else fail(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function fallback() {
    try {
      const current = prepareExport(getSnapshot(), window.location.origin);
      const markdown = current.media.reduce(
        (text, media) =>
          replaceMarkdownMediaUrl(
            text,
            media.url,
            new URL(media.url, window.location.origin).href,
          ),
        current.markdown,
      );
      downloadText("article.md", markdown);
    } catch (error) {
      fail(error);
    }
  }
  return (
    <>
      <button
        className="button obsidian-save-trigger"
        type="button"
        disabled={busy}
        onClick={() => void show()}
      >
        保存到 Obsidian
      </button>
      {open &&
        createPortal(
          <Modal title="保存到 Obsidian" onClose={close}>
            <p className="form-hint">
              保存点击时的当前稿快照，不会发布文章。Markdown
              转换可能丢失特殊块样式；平台视频保留链接，不下载视频。
            </p>
            {error && <Notice kind="error">{error}</Notice>}
            {!supported ? (
              <>
                <p className="form-hint">
                  当前浏览器不支持目录授权。普通下载仅含 Markdown
                  和原图片链接，不代表图片已落盘或已同步 Obsidian。
                </p>
                <button className="button" type="button" onClick={fallback}>
                  仅下载 Markdown
                </button>
              </>
            ) : (
              <>
                <label>
                  保存预设
                  <select
                    aria-label="保存预设"
                    disabled={busy}
                    value={
                      records.some((r) => r.preset.id === selected?.preset.id)
                        ? selected?.preset.id
                        : ""
                    }
                    onChange={(event) => {
                      request.current++;
                      const record = records.find(
                        (r) => r.preset.id === event.target.value,
                      );
                      setSelected(record);
                      setDirectory(record?.preset.noteDirectory ?? "");
                      setConflict(false);
                      setMissing(false);
                      setResult(undefined);
                      snapshot.current = null;
                    }}
                  >
                    <option value="">选择预设或其他位置</option>
                    {records.map((record) => (
                      <option key={record.preset.id} value={record.preset.id}>
                        {record.preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selected && (
                  <>
                    <p className="form-hint">
                      目标：{selected.handle.name}/{directory || "（根目录）"}
                      ；图片规则：{selected.preset.imageRule}
                    </p>
                    {!selected.preset.isVault && (
                      <p className="form-hint">
                        这是普通文件夹，不能报告为已同步 Obsidian。请选择包含
                        .obsidian 的仓库根目录。
                      </p>
                    )}
                    <button
                      className="button"
                      type="button"
                      disabled={busy}
                      onClick={() => void chooseChild()}
                    >
                      浏览文章子目录
                    </button>
                  </>
                )}
                <div className="button-group">
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => void chooseOther()}
                  >
                    选择其他位置
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={fallback}
                  >
                    仅下载 Markdown
                  </button>
                </div>
                <p className="form-hint">
                  普通下载仅保留网站图片链接，不代表图片已落盘。
                </p>
                {!records.length && (
                  <p className="form-hint">
                    可先在设置 → 同步 Obsidian
                    中添加预设；此处临时选择不会改动预设。
                  </p>
                )}
                {result && (
                  <Notice kind="success">
                    {result.isVault === false
                      ? "已保存到普通文件夹（未同步 Obsidian）"
                      : "已保存到本地目录"}
                    ：{result.path}
                    {result.openUri && (
                      <p className="form-hint">
                        <a href={result.openUri}>在 Obsidian 中打开</a>
                        （需要本机已安装，点击后请自行确认打开结果）
                      </p>
                    )}
                  </Notice>
                )}
              </>
            )}
            <div className="modal-actions button-group">
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={close}
              >
                取消
              </button>
              {supported && (
                <>
                  {missing && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void save(undefined, true)}
                    >
                      创建目录并保存
                    </button>
                  )}
                  {conflict ? (
                    <div className="button-group">
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void save("copy")}
                      >
                        另存副本
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void save("overwrite")}
                      >
                        确认覆盖本地修改
                      </button>
                    </div>
                  ) : (
                    <button
                      className="button primary"
                      type="button"
                      disabled={busy || !selected}
                      onClick={() => void save()}
                    >
                      {busy ? "正在保存…" : "保存本次快照"}
                    </button>
                  )}
                </>
              )}
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
