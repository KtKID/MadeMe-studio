// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Dashboard from "../../src/components/content/Dashboard";
import { defaultSettings } from "../../src/shared/contracts";
afterEach(cleanup);
const base = {
  id: "status-fixture",
  title: "状态验收",
  excerpt: "",
  category: "",
  tags: [],
  coverImage: "",
  visibility: "public" as const,
  pinned: false,
  version: 2,
  publishedAt: "2026-10-29",
  updatedAt: "2026-10-29",
  deletedAt: null,
};
function setup(extra: Record<string, unknown> = {}) {
  render(
    <Dashboard
      initial={{
        settings: defaultSettings,
        posts: [{ ...base, ...extra }],
        capabilities: {
          authenticated: true,
          aiConfigured: false,
          imageConfigured: false,
          passwordConfigured: false,
          storageConfigured: true,
          ownerConfigured: true,
        },
      }}
    />,
  );
}
it("状态保留线上公开性，并显示服务端派生的有新修改", () => {
  setup({
    hasUnpublishedChanges: true,
    publishedVisibility: "unlisted",
    visibility: "public",
  });
  expect(screen.getByText("有新修改")).toBeTruthy();
  expect(screen.getByText("不公开列出")).toBeTruthy();
  expect(
    screen.getByText("有新修改").closest(".publication-state")?.textContent,
  ).toContain("不公开列出");
});
it("无差异和旧摘要不凭更新时间猜测新修改", () => {
  setup({ hasUnpublishedChanges: false, updatedAt: "2026-11-01" });
  expect(screen.queryByText("有新修改")).toBeNull();
  expect(screen.getByText("公开")).toBeTruthy();
});
it("回收站不显示待发布提示", () => {
  setup({
    hasUnpublishedChanges: true,
    publishedVisibility: "public",
    deletedAt: "2026-10-30",
  });
  fireEvent.click(screen.getByRole("tab", { name: "回收站" }));
  expect(screen.getByRole("heading", { name: "状态验收" })).toBeTruthy();
  expect(screen.queryByText("有新修改")).toBeNull();
});
it("新修改使用独立橙红语义色，暗色有配套，不跟随皮肤强调色", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("src/modules/publication-status/styles.css", "utf8");
  expect(css).toContain("--publication-pending-bg");
  expect(css).toContain("--publication-pending-ink");
  expect(css).toContain('[data-color-mode="dark"]');
  expect(css).not.toContain("var(--tint)");
  expect(css).not.toContain("var(--accent)");
});
