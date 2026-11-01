import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateProductionConfig,
  readProductionSource,
  runProductionDeploy,
  productionCommit,
  assertCurrentMain,
} from "../scripts/deploy-production.mjs";
const source = await readProductionSource();
const ci = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "KtKID/MadeMe-studio",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  GITHUB_SHA: "a".repeat(40),
};
const config = () => ({
  ...source.env.production,
  keep_vars: true,
  compatibility_date: source.compatibility_date,
  compatibility_flags: source.compatibility_flags,
  assets: { binding: "ASSETS", directory: "../client" },
  main: "entry.mjs",
  no_bundle: true,
  vars: {},
});
it("生产产物必须是既有Worker、真实绑定与keep_vars；本地占位、vars覆盖或错误入口拒绝", () => {
  expect(validateProductionConfig(source, config())).toBe("author-studio");
  for (const patch of [
    { keep_vars: false },
    { d1_databases: source.d1_databases },
    { vars: { AUTH_MODE: "sites" } },
    { name: "author-studio-production" },
    { main: "index.js" },
  ])
    expect(() =>
      validateProductionConfig(source, { ...config(), ...patch }),
    ).toThrow();
});
it.each(["--dry-run", "--publish"])(
  "只执行当前版本ID的两步计划：%s（模拟进程，无网络）",
  (mode) => {
    const root = mkdtempSync(join(tmpdir(), "mademe-deploy-test-"));
    const calls: any[] = [];
    try {
      const result = runProductionDeploy({
        mode,
        source,
        generated: config(),
        directory: root,
        environment: {
          ...ci,
          CLOUDFLARE_ENV: "production",
        },
        execute: (args: any[], env: any) => {
          calls.push({ args, env });
          if (args[1] === "upload")
            writeFileSync(
              env.WRANGLER_OUTPUT_FILE_PATH,
              JSON.stringify({
                type: "version-upload",
                worker_name: "author-studio",
                version_id: "11111111-1111-4111-8111-111111111111",
              }) + "\n",
            );
          if (args[1] === "deploy")
            writeFileSync(
              env.WRANGLER_OUTPUT_FILE_PATH,
              JSON.stringify({
                type: "version-deploy",
                worker_name: "author-studio",
                deployment_id: "confirmed-deployment",
              }) + "\n",
              { flag: "a" },
            );
          return { status: 0 };
        },
      });
      expect(calls[0].args.slice(0, 2)).toEqual(["versions", "upload"]);
      expect(calls[0].args).toContain("--strict");
      expect(calls[0].env.CLOUDFLARE_ENV).toBeUndefined();
      if (mode === "--dry-run") {
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toContain("--dry-run");
        expect(result.dryRun).toBe(true);
      } else {
        expect(calls).toHaveLength(2);
        expect(calls[1].args).toContain(
          "11111111-1111-4111-8111-111111111111@100%",
        );
        expect(
          JSON.parse(
            readFileSync(
              calls[1].args[calls[1].args.indexOf("--config") + 1],
              "utf8",
            ),
          ),
        ).toEqual({ name: "author-studio" });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
it("缺CI来源、上传失败或结果不明确时不发布，不采用latest", () => {
  for (const failure of ["branch", "exit", "missing"]) {
    const root = mkdtempSync(join(tmpdir(), "mademe-deploy-test-"));
    const calls: any[] = [];
    try {
      expect(() =>
        runProductionDeploy({
          mode: "--publish",
          source,
          generated: config(),
          directory: root,
          environment: {
            ...ci,
            GITHUB_REF:
              failure === "branch" ? "refs/heads/preview" : ci.GITHUB_REF,
          },
          execute: (args: any[]) => {
            calls.push(args);
            return { status: failure === "exit" ? 1 : 0 };
          },
        }),
      ).toThrow();
      expect(calls.length).toBeLessThanOrEqual(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
it.each(["wrong-worker", "duplicate", "promotion-exit", "promotion-missing"])(
  "上传归属或发布结果不明确时不报成功，也不自动重试：%s",
  (failure) => {
    const root = mkdtempSync(join(tmpdir(), "mademe-deploy-test-"));
    const calls: string[][] = [];
    try {
      expect(() =>
        runProductionDeploy({
          mode: "--publish",
          source,
          generated: config(),
          directory: root,
          environment: {
            ...ci,
          },
          execute: (args: string[], env: any) => {
            calls.push(args);
            if (args[1] === "upload") {
              const record =
                JSON.stringify({
                  type: "version-upload",
                  worker_name:
                    failure === "wrong-worker"
                      ? "another-worker"
                      : "author-studio",
                  version_id: "11111111-1111-4111-8111-111111111111",
                }) + "\n";
              writeFileSync(
                env.WRANGLER_OUTPUT_FILE_PATH,
                failure === "duplicate" ? record + record : record,
              );
            }
            return {
              status:
                args[1] === "deploy" && failure === "promotion-exit" ? 1 : 0,
            };
          },
        }),
      ).toThrow();
      expect(calls.length).toBe(failure.startsWith("promotion") ? 2 : 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
it("GitHub生产来源拒绝PR、fork、tag、非main或伪造的Builds元数据", () => {
  expect(productionCommit(ci)).toBe(ci.GITHUB_SHA);
  expect(
    productionCommit({ ...ci, GITHUB_EVENT_NAME: "workflow_dispatch" }),
  ).toBe(ci.GITHUB_SHA);
  for (const patch of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_REPOSITORY: "someone/MadeMe-studio" },
    { GITHUB_REF: "refs/tags/main" },
    { GITHUB_REF: "refs/heads/preview" },
    { GITHUB_SHA: "invalid" },
    { GITHUB_ACTIONS: undefined },
  ])
    expect(() => productionCommit({ ...ci, ...patch })).toThrow();
  expect(() =>
    productionCommit({
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: ci.GITHUB_SHA,
    }),
  ).toThrow();
});
it("首次/排队发布必须核对当前main，不接受过时提交、API失败或缺凭据", async () => {
  const env = { ...ci, GITHUB_TOKEN: "fake-test-token" };
  let request: any;
  const fetcher = async (url: string, options: any) => {
    request = { url, options };
    return new Response(JSON.stringify({ object: { sha: ci.GITHUB_SHA } }));
  };
  await expect(assertCurrentMain(env, fetcher)).resolves.toBeUndefined();
  expect(request.url).toBe(
    "https://api.github.com/repos/KtKID/MadeMe-studio/git/ref/heads/main",
  );
  expect(request.options.redirect).toBe("error");
  for (const response of [
    new Response("denied", { status: 403 }),
    new Response(JSON.stringify({ object: { sha: "b".repeat(40) } })),
  ]) {
    await expect(
      assertCurrentMain(env, async () => response),
    ).rejects.toThrow();
  }
  await expect(assertCurrentMain(ci, fetcher)).rejects.toThrow();
});
