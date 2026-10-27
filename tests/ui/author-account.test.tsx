import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
}));
import StudioShell from "../../src/components/studio/StudioShell";
import LoginPanel from "../../src/components/auth/LoginPanel";
import { ownerAccount } from "../../src/server/auth/account";
import {
  accountInitial,
  accountPresentation,
  sanitizeDisplayName,
} from "../../src/shared/auth";
import { ownerDisplayName } from "../../src/server/auth/account";
import { defaultSettings } from "../../src/shared/contracts";
import type { StudioPageData } from "../../src/server/page-data";
import type { RuntimeEnv } from "../../src/server/runtime";

afterEach(() => vi.unstubAllGlobals());

function initial(
  authenticated: boolean,
  account?: string | null,
  accountName?: string | null,
): StudioPageData {
  return {
    settings: defaultSettings,
    posts: [],
    initialMedia: [],
    initialTokens: [],
    postsError: "",
    mediaError: "",
    tokensError: "",
    trustedIdentity: null,
    ...(account === undefined ? {} : { account }),
    ...(accountName === undefined ? {} : { accountName }),
    capabilities: {
      authenticated,
      aiConfigured: false,
      imageConfigured: false,
      passwordConfigured: false,
      storageConfigured: true,
      ownerConfigured: true,
    },
  };
}
function shell(data: StudioPageData) {
  return renderToStaticMarkup(
    createElement(StudioShell, {
      initial: data,
      initialPath: "/studio",
      passwordAuth: true,
    }),
  );
}

describe("侧边栏作者账号展示", () => {
  it("已登录显示账号名、首字母头像与账号与退出提示", () => {
    const html = shell(initial(true, "owner@gmail.com"));
    expect(html).toContain('class="author-account-name">owner@gmail.com<');
    expect(html).toContain("账号与退出");
    expect(html).toContain('aria-hidden="true">O<');
    expect(html).not.toContain("作者登录 / 账号与退出");
    expect(html).toContain('href="/login?returnTo=%2Fstudio"');
  });
  it("有 Google 昵称时优先显示昵称，悬停提示包含邮箱", () => {
    const html = shell(initial(true, "owner@gmail.com", "小明"));
    expect(html).toContain('class="author-account-name">小明<');
    expect(html).toContain('aria-hidden="true">小<');
    expect(html).toContain("已登录：小明（owner@gmail.com）（账号与退出）");
    expect(shell(initial(false, "owner@gmail.com", "小明"))).not.toContain(
      "小明",
    );
  });
  it("未登录或缺少账号时保持原“作者登录”文案，不泄露账号", () => {
    for (const data of [
      initial(false),
      initial(false, "owner@gmail.com"),
      initial(true, null),
    ]) {
      const html = shell(data);
      expect(html).toContain("作者登录 / 账号与退出");
      expect(html).not.toContain("owner@gmail.com");
      expect(html).not.toContain("author-account-name");
    }
  });
  it("侧边栏底部只保留账号入口：去掉“我的站点”卡片与底部标语，右上角保留访问站点", () => {
    const html = shell(initial(true, "owner@gmail.com", "小明"));
    expect(html).not.toContain("我的站点");
    expect(html).not.toContain("看看发布后的样子");
    expect(html).not.toContain("写作，让想法有迹可循");
    expect(html).not.toContain("sidebar-note");
    expect(html).toMatch(/<a class="topbar-site" href="\/">访问站点/);
    const bottom = html.slice(html.indexOf('class="sidebar-bottom"'));
    expect(bottom.indexOf("author-link")).toBeGreaterThan(-1);
    expect(bottom.indexOf("author-link")).toBeLessThan(bottom.indexOf("</aside>"));
    // 非 Sites 登录模式（无账号入口）时不渲染空的底部容器。
    const sites = renderToStaticMarkup(
      createElement(StudioShell, {
        initial: initial(true, "owner@gmail.com"),
        initialPath: "/studio",
      }),
    );
    expect(sites).not.toContain("sidebar-bottom");
  });
  it("Studio.astro 与 StudioShell 一致，左右底栏共用高度，账号保持横向并兼容长昵称", () => {
    const astro = readFileSync("src/layouts/Studio.astro", "utf8");
    const css = readFileSync("src/styles/global.css", "utf8");
    for (const text of ["我的站点", "看看发布后的样子", "写作，让想法有迹可循", "sidebar-note"])
      expect(astro).not.toContain(text);
    expect(astro).toContain('class="topbar-site" href="/"');
    expect(css).toMatch(/--studio-footer-height:\s*56px/);
    expect(css).toMatch(/\.sidebar-bottom \{[^}]*min-height: var\(--studio-footer-height\)/);
    expect(css).toMatch(/\.studio-footer \{[^}]*min-height: var\(--studio-footer-height\)/);
    expect(css).toMatch(/\.author-account \{[^}]*display: flex/);
    expect(css).toMatch(/\.author-account-name \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.author-link \{[^}]*border: 0/);
    expect(css).toMatch(/\.studio-sidebar \{[^}]*overflow-y: auto/);
    expect(css).not.toContain(".sidebar-note");
  });
  it("登录页已登录状态显示账号名", () => {
    const html = renderToStaticMarkup(
      createElement(LoginPanel, {
        secureTransport: true,
        returnTo: "/studio",
        session: {
          mode: "google",
          configured: true,
          authenticated: true,
          account: "owner@gmail.com",
        },
      }),
    );
    expect(html).toContain("已登录：owner@gmail.com");
  });
});

describe("ownerAccount 仅向已验证作者返回配置邮箱", () => {
  const env = (patch: Partial<RuntimeEnv>) =>
    ({ OWNER_EMAIL: " Owner@Gmail.com ", ...patch }) as RuntimeEnv;
  it("google/password 模式返回规范化邮箱", () => {
    for (const mode of ["google", "password"])
      expect(ownerAccount(env({ AUTH_MODE: mode }), { owner: true })).toBe(
        "owner@gmail.com",
      );
  });
  it("未登录、Sites/开发模式或非法配置返回 null", () => {
    expect(ownerAccount(env({ AUTH_MODE: "google" }), { owner: false })).toBe(
      null,
    );
    expect(ownerAccount(env({ AUTH_MODE: "sites" }), { owner: true })).toBe(
      null,
    );
    expect(ownerAccount(env({ AUTH_MODE: undefined }), { owner: true })).toBe(
      null,
    );
    expect(
      ownerAccount(env({ AUTH_MODE: "google", OWNER_EMAIL: "not-an-email" }), {
        owner: true,
      }),
    ).toBe(null);
  });
  it("昵称仅 Google 作者可见", () => {
    const named = { owner: true, displayName: "小明" };
    expect(ownerDisplayName(env({ AUTH_MODE: "google" }), named)).toBe("小明");
    expect(ownerDisplayName(env({ AUTH_MODE: "password" }), named)).toBe(null);
    expect(
      ownerDisplayName(env({ AUTH_MODE: "google" }), {
        owner: false,
        displayName: "小明",
      }),
    ).toBe(null);
    expect(accountPresentation(null, "a@b.test")).toEqual({
      label: "a@b.test",
      title: "已登录：a@b.test（账号与退出）",
    });
    expect(accountPresentation(null, null)).toBe(null);
  });
  it("清洗昵称：控制/双向/零宽字符、空白折叠、64 码点截断", () => {
    expect(sanitizeDisplayName(" a\u200b\u202eb\t\n c ")).toBe("ab c");
    expect(sanitizeDisplayName("   ")).toBe(null);
    expect(sanitizeDisplayName(42)).toBe(null);
    expect(Array.from(sanitizeDisplayName("😀".repeat(80))!)).toHaveLength(64);
  });
  it("头像字母取首个字母或数字", () => {
    expect(accountInitial("owner@gmail.com")).toBe("O");
    expect(accountInitial("_9x@a.test")).toBe("9");
    expect(accountInitial(null)).toBe("A");
    expect(accountInitial("小明")).toBe("小");
  });
});
