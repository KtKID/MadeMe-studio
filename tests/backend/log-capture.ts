import { vi } from "vitest";

export type LogRecord = Record<string, unknown> & {
  level: string;
  event: string;
};

/** 按时间顺序捕获统一日志接口写出的 JSON 行；测试结束由 vi.restoreAllMocks 还原 console。 */
export function captureLogs() {
  const calls: unknown[][] = [];
  for (const method of ["debug", "log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
  const raw = () => JSON.stringify(calls);
  const records = (): LogRecord[] =>
    calls.flatMap((args) => {
      if (typeof args[0] !== "string") return [];
      try {
        return [JSON.parse(args[0]) as LogRecord];
      } catch {
        // 非 JSON 行（第三方库输出）不属于统一日志，忽略。
        return [];
      }
    });
  const find = (event: string) => records().filter((r) => r.event === event);
  return { raw, records, find };
}
