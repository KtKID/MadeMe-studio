import { it, expect } from "vitest";
import {
  saveRecovery,
  latestRecovery,
} from "../src/components/editor/local-recovery";
import { defaultPost } from "./fixtures/editor-post";
function storage() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}
it("完整副本保留基准与本地内容，重开可恢复且不会覆盖先前副本", () => {
  const s = storage(),
    b = defaultPost(),
    l = { ...b, title: "本地" };
  saveRecovery(s, b, l);
  const second = saveRecovery(s, b, { ...l, title: "第二份" });
  expect(s.length).toBe(2);
  expect(latestRecovery(s, b.id)).toEqual(second);
  expect(latestRecovery(s, "other")).toBeNull();
});
it("存储拒绝、静默不写、损坏数据都不能误报已备份", () => {
  const s = storage(),
    b = defaultPost();
  expect(() =>
    saveRecovery(
      {
        ...s,
        setItem() {
          throw Error("quota");
        },
      },
      b,
      b,
    ),
  ).toThrow();
  expect(() => saveRecovery({ ...s, setItem() {} }, b, b)).toThrow();
});
