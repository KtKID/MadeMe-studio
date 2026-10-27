import { expect, it, vi } from "vitest";
it("服务端与浏览器使用显式同一展示时区，避免日期hydration替换并复用 formatter", async () => {
  vi.resetModules();
  const Original = Intl.DateTimeFormat;
  const spy = vi
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(function (locale, options) {
      return new Original(locale, options);
    });
  const { date } = await import("../../src/components/shared/ui");
  date("2026-10-27T01:00:00Z");
  expect(spy.mock.calls[0][1]).toMatchObject({ timeZone: "Asia/Shanghai" });
  date("2026-10-28T01:00:00Z");
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
