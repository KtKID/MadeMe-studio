import { expect, it, vi } from "vitest";
import { date } from "../../src/components/shared/ui";
it("服务端与浏览器使用显式同一展示时区，避免日期hydration替换", () => {
  const Original = Intl.DateTimeFormat;
  const spy = vi
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(function (locale, options) {
      return new Original(locale, options);
    });
  date("2026-10-27T01:00:00Z");
  expect(spy.mock.calls[0][1]).toMatchObject({ timeZone: "Asia/Shanghai" });
  spy.mockRestore();
});
