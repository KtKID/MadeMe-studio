import { useEffect, useRef, useState } from "react";
import { Modal, Notice, Busy } from "../../components/shared/ui";
import { clientLog } from "../log/client";
import {
  isDirectoryPickerSupported,
  pickDirectory,
} from "../obsidian-local/directory";
import {
  getRepository,
  setRepository,
  clearRepository,
  authorizeRepositoryRead,
  checkRepositoryRead,
  RepositoryReadPermissionError,
  subscribeRepositoryChanges,
  type RepositoryConnection,
} from "./connection";

/** 仅当前浏览器的独立导入连接；不参与服务端settings PATCH或笔记导出预设CRUD。 */
export default function RepositorySettings() {
  const [connection, setConnection] = useState<RepositoryConnection>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [needsPermission, setNeedsPermission] = useState(false),
    [clearing, setClearing] = useState(false);
  const generation = useRef(0),
    locked = useRef(false);
  function fail(e: unknown) {
    clientLog("warn", "obsidian_repository.settings_failed", {
      reason: e instanceof DOMException ? e.name : "operation_failed",
    });
    setError(
      e instanceof Error || e instanceof DOMException
        ? e.message
        : "仓库连接操作失败，原连接保留。",
    );
  }
  async function refresh() {
    const current = ++generation.current;
    try {
      const found = await getRepository();
      if (current !== generation.current) return;
      setConnection(found);
      setNeedsPermission(false);
      if (found) {
        try {
          await checkRepositoryRead(found);
        } catch (e) {
          if (current === generation.current) {
            setNeedsPermission(e instanceof RepositoryReadPermissionError);
            fail(e);
          }
        }
      }
    } catch (e) {
      if (current === generation.current) fail(e);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const stop = subscribeRepositoryChanges(() => {
      if (!locked.current) void refresh();
    });
    return () => {
      generation.current++;
      stop();
    };
  }, []);
  async function select() {
    if (locked.current) return;
    const current = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // 直接在点击事件打开原生picker，只请求read；不读取/复制旧预设。
      const handle = await pickDirectory(connection?.handle ?? "documents");
      if (current !== generation.current) return;
      const saved = await setRepository(handle);
      if (current === generation.current) {
        setConnection(saved);
        setNeedsPermission(false);
        setMessage("Obsidian 仓库已连接，仅此浏览器与域名可用。");
      }
    } catch (e) {
      if (current === generation.current) {
        if (
          (e instanceof Error || e instanceof DOMException) &&
          e.name === "AbortError"
        )
          setMessage("已取消选择，原仓库连接保持不变。");
        else fail(e);
      }
    } finally {
      locked.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  async function authorize() {
    if (!connection || locked.current) return;
    const current = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await authorizeRepositoryRead(connection);
      await checkRepositoryRead(connection);
      if (current === generation.current) {
        setNeedsPermission(false);
        setMessage("仓库读取授权已恢复。");
      }
    } catch (e) {
      if (current === generation.current) fail(e);
    } finally {
      locked.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  async function clear() {
    if (locked.current) return;
    const current = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await clearRepository();
      if (current === generation.current) {
        setConnection(undefined);
        setNeedsPermission(false);
        setClearing(false);
        setMessage("导入仓库连接已清除，本地文件和笔记导出预设没有改变。");
      }
    } catch (e) {
      if (current === generation.current) fail(e);
    } finally {
      locked.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  const supported = isDirectoryPickerSupported();
  return (
    <div className="form-stack">
      <div className="section-heading">
        <h2>Obsidian 仓库</h2>
        <p>用于导入文章，独立于“同步 Obsidian”的笔记导出预设。</p>
      </div>
      <p className="form-hint">
        选择仓库根目录后，导入只需指定一篇
        Markdown，自动读取它引用的图片、视频和动图。不上传整库，不修改原文。连接只保存在此浏览器与域名，不会上传服务器。
      </p>
      {loading ? (
        <Busy text="读取仓库连接…" />
      ) : (
        <div className="config-card">
          <strong>
            {connection
              ? `已连接：${connection.name}`
              : "尚未连接 Obsidian 仓库"}
          </strong>
          <p className="form-hint">
            {connection
              ? "保存的是可读取的目录句柄，而非磁盘路径字符串。"
              : "不会自动从笔记导出预设迁移目录或权限。"}
          </p>
          <div className="button-group">
            <button
              type="button"
              className="button primary"
              disabled={busy || !supported}
              onClick={() => void select()}
            >
              {connection ? "更换仓库目录" : "选择仓库目录"}
            </button>
            {connection && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setClearing(true);
                  setError("");
                }}
              >
                清除连接
              </button>
            )}
            {connection && needsPermission && (
              <button
                type="button"
                className="button"
                disabled={busy || !supported}
                onClick={() => void authorize()}
              >
                重新授权仓库（只读）
              </button>
            )}
          </div>
        </div>
      )}
      {!supported && (
        <Notice>
          此浏览器不支持本机目录授权，请使用支持该能力的桌面浏览器。不会伪装已连接。
        </Notice>
      )}
      {busy && <Busy text="正在处理仓库连接…" />}
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <p className="form-hint">
        删除、改名或修改导出预设不会影响此连接。测试 Site
        与正式博客不同域名，需要分别明确选择仓库。
      </p>
      {clearing && (
        <Modal
          title="清除导入仓库连接？"
          onClose={() => {
            if (!busy) setClearing(false);
          }}
        >
          <p>
            仅清除当前浏览器的导入连接；不会删除文件、撤销其他授权或修改笔记导出预设。
          </p>
          {error && <Notice kind="error">{error}</Notice>}
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setClearing(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void clear()}
            >
              确认清除连接
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
