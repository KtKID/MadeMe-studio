import { test, expect } from "@playwright/test";

test("登录入口遵循部署模式：Sites不出现第二套密码，未配置不开放登录", async ({
  page,
  request,
}) => {
  const session = await (await request.get("/api/auth/session")).json();
  await page.goto("/login");
  if (session.mode === "sites") {
    await expect(
      page.getByText("本站使用平台登录，无需再输入一套网站密码。"),
    ).toBeVisible();
    await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);
  } else if (
    session.mode === "password" &&
    new URL(page.url()).protocol !== "https:"
  ) {
    await expect(
      page.getByRole("heading", { name: "请使用安全连接" }),
    ).toBeVisible();
    await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);
  } else if (!session.configured) {
    await expect(
      page.getByRole("heading", { name: "作者登录暂不可用" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toHaveCount(0);
  }
});

test("@password 登录失败可重试、密码立即清空、忙碌防止重复提交", async ({
  page,
  request,
}) => {
  const session = await (await request.get("/api/auth/session")).json();
  test.skip(
    !new URL(
      page.url() === "about:blank"
        ? (test.info().project.use.baseURL as string)
        : page.url(),
    ).protocol.startsWith("https") ||
      session.mode !== "password" ||
      !session.configured ||
      session.authenticated,
    "需要已配置独立认证的访客测试环境",
  );
  await page.goto("/login?returnTo=//evil.example");
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/login", async (route) => {
    calls++;
    await pending;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "do-not-display-internal-details" },
      }),
    });
  });
  await page.getByLabel("作者邮箱").fill("fixture@example.test");
  await page
    .getByLabel("密码", { exact: true })
    .fill("fixture-only-not-a-real-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在登录…" })).toBeDisabled();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  release();
  await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
  await expect(page.getByRole("alert")).not.toContainText("internal-details");
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeEnabled();
  expect(calls).toBe(1);
  await page.getByLabel("密码", { exact: true }).fill("fixture-only-retry");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
  expect(calls).toBe(2);
});

test("@password 真实作者登录与显式退出", async ({ page, request }) => {
  const email = process.env.E2E_AUTHOR_EMAIL;
  const password = process.env.E2E_AUTHOR_PASSWORD;
  const session = await (await request.get("/api/auth/session")).json();
  test.skip(
    !email ||
      !password ||
      !new URL(
        page.url() === "about:blank"
          ? (test.info().project.use.baseURL as string)
          : page.url(),
      ).protocol.startsWith("https") ||
      session.mode !== "password" ||
      !session.configured,
    "仅在明确配置的隔离验收环境运行真实登录；不生成真实凭据",
  );
  await page.goto("/login?returnTo=/studio/media");
  if (!session.authenticated) {
    await page.getByLabel("作者邮箱").fill(email!);
    await page.getByLabel("密码", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/studio\/media$/);
  }
  await page.goto("/login");
  await expect(page.getByText("你已通过作者身份验证。")).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "退出作者账号" }).click();
  await expect(page.getByText("你已通过作者身份验证。")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "退出作者账号" }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});
