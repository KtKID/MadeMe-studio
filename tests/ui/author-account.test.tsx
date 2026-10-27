import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
}));
import StudioShell from "../../src/components/studio/StudioShell";
import LoginPanel from "../../src/components/auth/LoginPanel";
import { ownerAccount } from "../../src/server/auth/account";
import { accountInitial } from "../../src/shared/auth";
import { defaultSettings } from "../../src/shared/contracts";
import type { StudioPageData } from "../../src/server/page-data";
import type { RuntimeEnv } from "../../src/server/runtime";

afterEach(() => vi.unstubAllGlobals());

function initial(
  authenticated: boolean,
  account?: string | null,
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
  it("头像字母取首个字母或数字", () => {
    expect(accountInitial("owner@gmail.com")).toBe("O");
    expect(accountInitial("_9x@a.test")).toBe("9");
    expect(accountInitial(null)).toBe("A");
  });
});
