import { clientLog } from "../log/client";
import { OBSIDIAN_REPOSITORY_LOCAL as LOCAL } from "../config/limits";
import { verifyVault } from "../obsidian-local/directory";
import type { DirectoryHandle } from "../obsidian-local/contracts";
import {
  getRepository,
  insertRepository,
  confirmRepository,
  removeRepository,
} from "./store";
import type { Repository, RepositoryPreset, RepositoryRoot } from "./models";
export {
  repositorySchema as repositoryConnectionSchema,
  repositoryLabel,
} from "./models";
export type {
  Repository as RepositoryConnection,
  Repository,
  RepositoryPreset,
  RepositoryRoot,
} from "./models";
export {
  getRepository,
  listRepositories,
  listWorkspace,
  savePreset,
  removePreset,
} from "./store";
export class RepositoryReadPermissionError extends Error {
  constructor(readonly state: PermissionState) {
    super(
      state === "denied"
        ? "Obsidian 仓库读取权限被拒绝，请重新授权读取；不会请求写权限。"
        : "Obsidian 仓库需要重新授权读取，当前正文未改变。",
    );
    this.name = "RepositoryReadPermissionError";
  }
}
export async function checkRepositoryRead(root: RepositoryRoot) {
  const state =
    (await root.handle.queryPermission?.({ mode: "read" })) ?? "prompt";
  if (state !== "granted") throw new RepositoryReadPermissionError(state);
  if (!(await verifyVault(root.handle)))
    throw new Error(
      "连接的目录找不到 .obsidian，请在 Obsidian 仓库设置重新选择；当前正文未改变。",
    );
}

export async function addRepository(handle: DirectoryHandle) {
  await checkRepositoryRead({ name: handle.name, handle });
  const saved = await insertRepository(handle);
  notifyRepositoryChange(saved.id);
  return saved;
}
export async function confirmRepositoryIdentity(repository: Repository) {
  await assertRepositoryCurrent(repository);
  await checkRepositoryRead(repository);
  const saved = await confirmRepository(repository.id, repository.revision);
  notifyRepositoryChange(saved.id);
  return saved;
}
export async function deleteRepository(
  repository: Repository,
  presets: RepositoryPreset[],
) {
  await removeRepository(repository, presets);
  notifyRepositoryChange(repository.id);
}
export async function assertRepositoryCurrent(repository: Repository) {
  const current = await getRepository(repository.id);
  if (!current || current.revision !== repository.revision)
    throw new Error(
      "所选Obsidian仓库已变化或删除，请重新选择；不会自动换用其他仓库。 ",
    );
}
export async function authorizeRepositoryRead(repository: Repository) {
  await assertRepositoryCurrent(repository);
  if (!repository.handle.requestPermission)
    throw new Error(
      "浏览器不能恢复此目录读取授权，请在支持的浏览器核对此仓库。 ",
    );
  const permission = await repository.handle.requestPermission({
    mode: "read",
  });
  if (permission !== "granted")
    throw new RepositoryReadPermissionError(permission);
  await assertRepositoryCurrent(repository);
}
/** 通知只传变化事件，不传句柄或路径；通道不可用时版本校验仍有效。 */
function changeChannel(): BroadcastChannel | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.BroadcastChannel !== "function"
  )
    return undefined;
  try {
    return new window.BroadcastChannel(LOCAL.changeEvent);
  } catch (error) {
    logChannelFailure(error);
    return undefined;
  }
}
function logChannelFailure(error: unknown) {
  clientLog("warn", "obsidian_repository.change_channel_unavailable", {
    reason: error instanceof DOMException ? error.name : "operation_failed",
  });
}
function notifyRepositoryChange(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL.changeEvent, { detail: { id } }));
  const channel = changeChannel();
  try {
    channel?.postMessage({ id });
  } catch (error) {
    logChannelFailure(error);
  } finally {
    channel?.close();
  }
}
export function subscribeRepositoryChanges(listener: (id?: string) => void) {
  if (typeof window === "undefined") return () => {};
  const local = (event: Event) =>
    listener((event as CustomEvent<{ id?: string }>).detail?.id);
  const remote = (event: MessageEvent) =>
    listener(typeof event.data?.id === "string" ? event.data.id : undefined);
  window.addEventListener(LOCAL.changeEvent, local);
  const channel = changeChannel();
  channel?.addEventListener("message", remote);
  return () => {
    window.removeEventListener(LOCAL.changeEvent, local);
    channel?.close();
  };
}
