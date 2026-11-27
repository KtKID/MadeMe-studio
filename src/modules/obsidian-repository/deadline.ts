import { clientLog } from "../log/client";
import { OBSIDIAN_WORKSPACE_LOCAL as LOCAL } from "../config/limits";

/** 目录权限或同根比较挂起。调用方必须结束等待并保留原配置。 */
export const DIRECTORY_QUERY_TIMEOUT_MESSAGE =
  "目录权限或同目录确认超时，现有仓库与授权均保留。请稍后重试。";
/** 设置页整次读取的兜底。内层更具体的失败优先展示。 */
export const SETTINGS_LOAD_TIMEOUT_MESSAGE =
  "读取仓库超时，现有配置未改动。请稍后重试。";

let directoryQueryTimeoutMs: number = LOCAL.directoryQueryTimeoutMs;
let settingsLoadTimeoutMs: number = LOCAL.settingsLoadTimeoutMs;
let loadProblem: string | undefined;

export class DirectoryQueryTimeoutError extends Error {
  constructor() {
    super(DIRECTORY_QUERY_TIMEOUT_MESSAGE);
    this.name = "DirectoryQueryTimeoutError";
  }
}
export class SettingsLoadTimeoutError extends Error {
  constructor() {
    super(SETTINGS_LOAD_TIMEOUT_MESSAGE);
    this.name = "SettingsLoadTimeoutError";
  }
}
export function setDirectoryQueryTimeoutForTests(ms?: number) {
  directoryQueryTimeoutMs =
    ms === undefined ? LOCAL.directoryQueryTimeoutMs : ms;
}
export function setSettingsLoadTimeoutForTests(ms?: number) {
  settingsLoadTimeoutMs = ms === undefined ? LOCAL.settingsLoadTimeoutMs : ms;
}
export function resetLoadDeadlineForTests() {
  setDirectoryQueryTimeoutForTests();
  setSettingsLoadTimeoutForTests();
  loadProblem = undefined;
}
/** 迁移可以继续保留记录；设置页在读取结束后展示这句，而不是一直转圈。 */
export function noteRepositoryLoadProblem(text: string) {
  loadProblem ??= text;
}
export function takeRepositoryLoadProblem() {
  const problem = loadProblem;
  loadProblem = undefined;
  return problem;
}
export type DirectoryQueryBudget = {
  readonly timedOut: boolean;
  remaining(): number;
  markTimedOut(): void;
  race<T>(operation: Promise<T>): Promise<T>;
};
function logLateFailure(error: unknown) {
  clientLog("warn", "obsidian_repository.deadline_late_failure", {
    reason:
      error instanceof Error || error instanceof DOMException
        ? error.name
        : "operation_failed",
  });
}
function rejectLate<T>(operation: Promise<T>) {
  void operation.then(
    () => {},
    (error) => logLateFailure(error),
  );
}
export function withDeadline<T>(
  ms: number,
  createError: () => Error,
  operation: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(createError());
    }, ms);
  });
  void operation.then(
    () => {},
    (error) => {
      if (timedOut) logLateFailure(error);
    },
  );
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
export function withDirectoryQueryTimeout<T>(
  operation: Promise<T>,
  ms = directoryQueryTimeoutMs,
): Promise<T> {
  return withDeadline(ms, () => new DirectoryQueryTimeoutError(), operation);
}
export function withSettingsLoadTimeout<T>(operation: Promise<T>): Promise<T> {
  return withDeadline(
    settingsLoadTimeoutMs,
    () => new SettingsLoadTimeoutError(),
    operation,
  );
}
/** 一批比较共用一个时限。某一个句柄挂起后，其余比较立即按未知身份结束。 */
export function startDirectoryQueryBudget(
  ms = directoryQueryTimeoutMs,
): DirectoryQueryBudget {
  const started = Date.now();
  let timedOut = false;
  return {
    get timedOut() {
      return timedOut;
    },
    remaining() {
      return Math.max(0, ms - (Date.now() - started));
    },
    markTimedOut() {
      timedOut = true;
    },
    async race<T>(operation: Promise<T>): Promise<T> {
      const left = Math.max(0, ms - (Date.now() - started));
      if (left <= 0) {
        timedOut = true;
        rejectLate(operation);
        throw new DirectoryQueryTimeoutError();
      }
      try {
        return await withDirectoryQueryTimeout(operation, left);
      } catch (error) {
        if (error instanceof DirectoryQueryTimeoutError) timedOut = true;
        throw error;
      }
    },
  };
}
