import { useEffect, useRef, useState } from "react";
import { Modal, Notice, Busy } from "../../components/shared/ui";
import { clientLog } from "../log/client";
import {
  isDirectoryPickerSupported,
  pickDirectory,
} from "../obsidian-local/directory";
import { normalizePath } from "../obsidian-local/save";
import { OBSIDIAN_LOCAL_DEFAULTS } from "../config/limits";
import {
  addRepository,
  authorizeRepositoryRead,
  checkRepositoryRead,
  confirmRepositoryIdentity,
  deleteRepository,
  listWorkspace,
  savePreset,
  removePreset,
  subscribeRepositoryChanges,
  repositoryLabel,
} from "./connection";
import {
  repositoryPresetSchema,
  type Repository,
  type RepositoryPreset,
  type Workspace,
} from "./models";
import "./repositories.css";
function logFailure(error: unknown) {
  clientLog("warn", "obsidian_repository.manager_failed", {
    reason: error instanceof DOMException ? error.name : "operation_failed",
  });
}
function message(error: unknown) {
  return error instanceof Error || error instanceof DOMException
    ? error.message
    : "操作未完成，原配置保留。";
}
function PresetEditor({
  repository,
  preset,
  onSaved,
  onCancel,
}: {
  repository: Repository;
  preset?: RepositoryPreset;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [id] = useState(() => preset?.id ?? crypto.randomUUID()),
    [name, setName] = useState(preset?.name ?? ""),
    [directory, setDirectory] = useState<string | undefined>(
      preset?.noteDirectory,
    ),
    [imageRule, setImageRule] = useState(
      preset?.imageRule ?? OBSIDIAN_LOCAL_DEFAULTS.imageRule,
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function choose() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const sequence = ++generation.current;
    try {
      await checkRepositoryRead(repository);
      const selected = await pickDirectory(repository.handle);
      if (!repository.handle.resolve)
        throw Error("浏览器不能确认子目录位于仓库内。 ");
      const path = await repository.handle.resolve(selected);
      if (!path) throw Error("文章目录必须位于所属仓库内。 ");
      const relative = normalizePath(...path);
      normalizePath(relative, imageRule);
      if (sequence === generation.current) setDirectory(relative);
    } catch (e) {
      if (sequence === generation.current) {
        logFailure(e);
        setError(message(e));
      }
    } finally {
      lock.current = false;
      if (sequence === generation.current) setBusy(false);
    }
  }
  async function save() {
    if (lock.current || directory === undefined) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await savePreset(
        {
          id,
          repositoryId: repository.id,
          name,
          noteDirectory: directory,
          imageRule,
        },
        preset?.revision,
      );
      await onSaved();
    } catch (e) {
      logFailure(e);
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const valid =
    directory !== undefined &&
    repositoryPresetSchema.safeParse({
      id,
      repositoryId: repository.id,
      revision: preset?.revision ?? id,
      name,
      noteDirectory: directory,
      imageRule,
    }).success;
  return (
    <div
      className="repository-preset-editor form-stack"
      aria-label={preset ? "编辑所属预设" : "新增所属预设"}
    >
      <h4>
        {preset ? "编辑预设" : "新增预设"} · {repository.name}
      </h4>
      <label>
        预设名称
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        文章子目录
        <div className="button-group">
          <input
            readOnly
            value={directory === undefined ? "" : directory || "（仓库根目录）"}
            placeholder="请选择所属仓库内的目录"
          />
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void choose()}
          >
            选择文章子目录
          </button>
        </div>
      </label>
      <label>
        图片存放规则
        <input
          value={imageRule}
          disabled={busy}
          onChange={(e) => setImageRule(e.target.value)}
        />
      </label>
      <p className="form-hint">
        预设仅保存规则，复用上方仓库目录，不重新选择根；图片规则相对于文章子目录。
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="button-group">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onCancel}
        >
          取消编辑
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || !valid}
          onClick={() => void save()}
        >
          保存所属预设
        </button>
      </div>
    </div>
  );
}
export default function RepositorySettings() {
  const [state, setState] = useState<Workspace>({
      repositories: [],
      presets: [],
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [permissions, setPermissions] = useState<
      Record<string, PermissionState>
    >({}),
    [editing, setEditing] = useState<{
      repositoryId: string;
      preset?: RepositoryPreset;
    }>();
  const [deletion, setDeletion] = useState<{
      repository: Repository;
      presets: RepositoryPreset[];
      preset?: RepositoryPreset;
    }>(),
    [confirmation, setConfirmation] = useState<Repository>(),
    [reconfirm, setReconfirm] = useState(false);
  const lock = useRef(false),
    generation = useRef(0);
  async function refresh() {
    const sequence = ++generation.current;
    try {
      const next = await listWorkspace();
      const rows = await Promise.all(
        next.repositories.map(async (repository) => {
          try {
            return [
              repository.id,
              (await repository.handle.queryPermission?.({ mode: "read" })) ??
                "prompt",
            ] as const;
          } catch (e) {
            logFailure(e);
            return [repository.id, "prompt"] as const;
          }
        }),
      );
      if (sequence === generation.current) {
        setState(next);
        setPermissions(Object.fromEntries(rows));
      }
    } catch (e) {
      if (sequence === generation.current) {
        logFailure(e);
        setError(message(e));
      }
    } finally {
      if (sequence === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const stop = subscribeRepositoryChanges(() => {
      if (!lock.current) void refresh();
    });
    return () => {
      generation.current++;
      stop();
    };
  }, []);
  async function action(run: () => Promise<unknown>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
      setNotice(success);
      await refresh();
    } catch (e) {
      logFailure(e);
      setError(message(e));
      await refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function add() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const sequence = ++generation.current;
    try {
      const handle = await pickDirectory("documents");
      if (sequence !== generation.current) return;
      await addRepository(handle);
      setNotice("Obsidian 仓库已新增。可在其下新增预设，无预设也可导入。 ");
      await refresh();
    } catch (e) {
      if (sequence === generation.current) {
        if (
          (e instanceof Error || e instanceof DOMException) &&
          e.name === "AbortError"
        )
          setNotice("已取消新增，现有仓库与预设保持不变。");
        else {
          logFailure(e);
          setError(message(e));
        }
      }
    } finally {
      lock.current = false;
      if (
        sequence === generation.current ||
        generation.current === sequence + 1
      )
        setBusy(false);
    }
  }
  async function remove() {
    if (!deletion || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (deletion.preset)
        await removePreset(deletion.preset.id, deletion.preset.revision);
      else await deleteRepository(deletion.repository, deletion.presets);
      setEditing(undefined);
      setDeletion(undefined);
      setNotice("配置已删除；没有删除任何磁盘文件或目录。 ");
      await refresh();
    } catch (e) {
      logFailure(e);
      setError(message(e));
      setReconfirm(true);
      await refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const supported = isDirectoryPickerSupported();
  return (
    <div className="obsidian-repositories form-stack">
      <div className="section-heading">
        <h2>Obsidian 仓库</h2>
        <p>
          仓库保存目录连接，笔记预设是其下的导出规则。导入直接使用仓库，无预设也可用。
        </p>
      </div>
      <p className="form-hint">
        配置仅保存在当前浏览器与域名。不上传整库、不修改原笔记；导入只读取，保存到
        Obsidian 时才明确申请写权限。
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {loading ? (
        <Busy text="读取仓库与兼容旧配置…" />
      ) : !state.repositories.length ? (
        <Notice>尚未添加 Obsidian 仓库，请使用下方按钮选择真实目录。</Notice>
      ) : (
        state.repositories.map((repository) => {
          const children = state.presets.filter(
            (p) => p.repositoryId === repository.id,
          );
          return (
            <section
              className="repository-card"
              data-repository-id={repository.id}
              key={repository.id}
            >
              <div className="repository-heading">
                <div>
                  <h3>{repositoryLabel(repository)}</h3>
                  <p className="form-hint">
                    {children.length} 个笔记预设 ·{" "}
                    {permissions[repository.id] === "granted"
                      ? "可读取"
                      : "需要恢复读取授权"}
                  </p>
                </div>
                <div className="button-group">
                  {permissions[repository.id] !== "granted" && (
                    <button
                      type="button"
                      className="button small"
                      disabled={busy || !supported}
                      onClick={() =>
                        void action(
                          () => authorizeRepositoryRead(repository),
                          "仓库读取授权已恢复。 ",
                        )
                      }
                    >
                      重新授权读取
                    </button>
                  )}
                  <button
                    type="button"
                    className="button small"
                    disabled={busy}
                    onClick={() => {
                      setDeletion({ repository, presets: children });
                      setError("");
                      setReconfirm(false);
                    }}
                  >
                    删除仓库
                  </button>
                </div>
              </div>
              {repository.identity === "pending" && (
                <div className="repository-pending">
                  <Notice>
                    历史目录待确认：读取权限或目录身份尚未核实，现有记录已分别保留，未按名称合并。
                  </Notice>
                  <button
                    type="button"
                    className="button small"
                    disabled={busy}
                    onClick={() => setConfirmation(repository)}
                  >
                    确认保留为独立仓库
                  </button>
                </div>
              )}
              <div className="repository-presets">
                <div className="repository-heading">
                  <h4>笔记预设</h4>
                  <button
                    type="button"
                    className="button small"
                    disabled={busy}
                    onClick={() => setEditing({ repositoryId: repository.id })}
                  >
                    新增预设
                  </button>
                </div>
                {!children.length ? (
                  <p className="form-hint">
                    还没有预设，不影响从这个仓库导入文章。
                  </p>
                ) : (
                  <ul className="repository-preset-list">
                    {children.map((preset) => (
                      <li key={preset.id}>
                        <div>
                          <strong>{preset.name}</strong>
                          <p className="form-hint">
                            文章：{preset.noteDirectory || "（仓库根目录）"} ·
                            图片：{preset.imageRule}
                          </p>
                        </div>
                        <div className="button-group">
                          <button
                            type="button"
                            className="button small"
                            disabled={busy}
                            onClick={() =>
                              setEditing({
                                repositoryId: repository.id,
                                preset,
                              })
                            }
                          >
                            编辑 {preset.name}
                          </button>
                          <button
                            type="button"
                            className="button small"
                            disabled={busy}
                            onClick={() => {
                              setDeletion({
                                repository,
                                presets: children,
                                preset,
                              });
                              setError("");
                              setReconfirm(false);
                            }}
                          >
                            删除 {preset.name}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {editing?.repositoryId === repository.id && (
                  <PresetEditor
                    key={editing.preset?.id ?? repository.id}
                    repository={repository}
                    preset={editing.preset}
                    onCancel={() => setEditing(undefined)}
                    onSaved={async () => {
                      setEditing(undefined);
                      setNotice("所属预设已保存，仓库连接保持不变。 ");
                      await refresh();
                    }}
                  />
                )}
              </div>
            </section>
          );
        })
      )}
      <div className="repository-add">
        <button
          type="button"
          className="button primary"
          disabled={busy || loading || !supported}
          onClick={() => void add()}
        >
          新增 Obsidian 仓库
        </button>
      </div>
      {!supported && (
        <Notice>
          此浏览器不支持本机目录授权；已保存配置仍保留，不会伪装新目录选择成功。
        </Notice>
      )}
      {deletion && (
        <Modal
          title={deletion.preset ? "删除笔记预设？" : "删除 Obsidian 仓库？"}
          onClose={() => {
            if (!busy) setDeletion(undefined);
          }}
        >
          <p>仓库：{repositoryLabel(deletion.repository)}</p>
          {deletion.preset ? (
            <p>仅删除预设“{deletion.preset.name}”；仓库连接和导入不受影响。</p>
          ) : (
            <>
              <p>
                将删除此仓库及所属 {deletion.presets.length} 个预设的本站配置：
              </p>
              <ul>
                {deletion.presets.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
            </>
          )}
          <p>绝不删除磁盘目录、Markdown、图片或视频。取消不改变任何配置。</p>
          {error && <Notice kind="error">{error}</Notice>}
          {reconfirm && (
            <p className="form-hint">请取消后重新打开，核对最新删除范围。</p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setDeletion(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || reconfirm}
              onClick={() => void remove()}
            >
              {deletion.preset ? "确认删除预设" : "确认删除仓库及所属预设"}
            </button>
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title="确认历史仓库"
          onClose={() => {
            if (!busy) setConfirmation(undefined);
          }}
        >
          <p>
            保留“{repositoryLabel(confirmation)}
            ”为独立仓库，不与其他记录合并。其所属预设与文件不变；将校验现有读取能力，不申请写权限。
          </p>
          {error && <Notice kind="error">{error}</Notice>}
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setConfirmation(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await confirmRepositoryIdentity(confirmation);
                  setConfirmation(undefined);
                }, "历史仓库已确认保留。 ")
              }
            >
              确认保留此仓库
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
