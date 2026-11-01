import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = join(projectRoot, "dist/server/wrangler.json");
/** 只接受目标仓库main的push/手动构建；CI元数据是防误用校验，不代替token权限。
 * @param {NodeJS.ProcessEnv} environment
 */
export function productionCommit(environment) {
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_REPOSITORY !== "KtKID/MadeMe-studio" ||
    environment.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(
      environment.GITHUB_EVENT_NAME ?? "",
    ) ||
    !/^[0-9a-f]{40}$/.test(environment.GITHUB_SHA ?? "")
  )
    throw new Error("只允许目标GitHub仓库main的明确push/手动构建发布。");
  return environment.GITHUB_SHA;
}
/** 防止排队构建/手动旧提交回退生产；只读GitHub，不访问Cloudflare。
 * @param {NodeJS.ProcessEnv} environment
 * @param {(url:string,options:RequestInit)=>Promise<Response>} fetcher
 */
export async function assertCurrentMain(environment, fetcher = fetch) {
  const commit = productionCommit(environment);
  if (!environment.GITHUB_TOKEN)
    throw new Error("缺少只读GitHub认证，不能确认main。");
  const response = await fetcher(
    "https://api.github.com/repos/KtKID/MadeMe-studio/git/ref/heads/main",
    {
      headers: {
        Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `无法确认main，GitHub HTTP ${response.status}；未发起发布。`,
    );
  const ref = await response.json();
  if (ref.object?.sha !== commit)
    throw new Error(
      "main已有新提交，本次旧构建不发布；请等待最新提交通过检查。",
    );
}
/** 使用Wrangler自己的JSONC解析器，避免Prettier尾逗号/注释被JSON.parse误拒；不加载任何密钥文件。 */
export async function readProductionSource() {
  const { experimental_readRawConfig } = await import("wrangler");
  return experimental_readRawConfig({
    config: join(projectRoot, "wrangler.jsonc"),
  }).rawConfig;
}
/** @param {Record<string, any>} source @param {Record<string, any>} generated */
export function validateProductionConfig(source, generated) {
  const expected = source.env?.production;
  const requireMatch = (
    /** @type {unknown} */ condition,
    /** @type {string} */ message,
  ) => {
    if (!condition) throw new Error(message);
  };
  requireMatch(
    expected?.name === source.name && generated.name === expected.name,
    "生产Worker名称不匹配。",
  );
  requireMatch(
    source.keep_vars === true && generated.keep_vars === true,
    "生产产物必须保留Dashboard变量。",
  );
  requireMatch(
    isDeepStrictEqual(
      generated.compatibility_flags,
      source.compatibility_flags,
    ) && generated.compatibility_date === source.compatibility_date,
    "兼容设置与已确认配置不一致。",
  );
  requireMatch(
    generated.main === "entry.mjs" && generated.no_bundle === true,
    "必须部署Astro生成的entry.mjs产物。",
  );
  requireMatch(
    generated.assets?.binding === source.assets?.binding &&
      generated.assets?.directory === "../client",
    "静态ASSETS绑定或目录不匹配。",
  );
  requireMatch(
    expected.d1_databases?.every(
      (/** @type {any} */ row) =>
        row.database_id && !/^0{8}-0{4}-4000-8000-0{12}$/.test(row.database_id),
    ),
    "production配置不得使用本地占位ID。",
  );
  const db = (/** @type {any[]} */ rows) =>
    rows?.map(({ binding, database_name, database_id, remote }) => ({
      binding,
      database_name,
      database_id,
      remote,
    }));
  requireMatch(
    isDeepStrictEqual(db(generated.d1_databases), db(expected.d1_databases)) &&
      generated.d1_databases?.length === 1,
    "生产D1绑定不匹配，拒绝部署本地占位数据库。",
  );
  requireMatch(
    isDeepStrictEqual(generated.r2_buckets, expected.r2_buckets),
    "生产R2绑定不匹配。",
  );
  requireMatch(
    !Object.keys(generated.vars ?? {}).length && !generated.secrets,
    "运行变量与secret必须沿用现有项目，不在产物内覆盖。",
  );
  requireMatch(
    generated.routes === undefined &&
      generated.route === undefined &&
      generated.workers_dev === undefined &&
      generated.preview_urls === undefined,
    "域名与访问设置继续由现有项目管理。",
  );
  return expected.name;
}
/** 上传与发布分开：仅发布本次上传明确返回的版本，不猜latest，不自动重试。
 * @param {{mode:string,source:Record<string,any>,generated:Record<string,any>,directory?:string,environment?:NodeJS.ProcessEnv,execute?:(args:string[],env:NodeJS.ProcessEnv)=>{status:number|null,error?:unknown,signal?:string|null}}} options
 */
export function runProductionDeploy({
  mode,
  source,
  generated,
  directory,
  environment = process.env,
  execute,
}) {
  if (!["--dry-run", "--publish"].includes(mode))
    throw new Error("请明确指定--dry-run或--publish。");
  const name = validateProductionConfig(source, generated),
    dryRun = mode === "--dry-run";
  const commit = dryRun ? undefined : productionCommit(environment);
  const work = directory ?? mkdtempSync(join(tmpdir(), "mademe-production-"));
  const output = join(work, "wrangler.ndjson"),
    promotion = join(work, "promotion.json");
  // 产物已在构建时选定production；避免再次套用环境，产生author-studio-production等新目标。
  const childEnv = {
    ...environment,
    WRANGLER_OUTPUT_FILE_PATH: output,
    WRANGLER_LOG_PATH: join(work, "wrangler.log"),
    WRANGLER_SEND_METRICS: "false",
  };
  delete childEnv.CLOUDFLARE_ENV;
  if (dryRun) {
    childEnv.XDG_CONFIG_HOME = join(work, "config");
    mkdirSync(childEnv.XDG_CONFIG_HOME, { recursive: true });
  }

  const run =
    execute ??
    ((args, env) =>
      spawnSync(
        process.execPath,
        [join(projectRoot, "node_modules/wrangler/bin/wrangler.js"), ...args],
        { cwd: projectRoot, env, stdio: "inherit" },
      ));
  const call = (/** @type {string[]} */ args) => {
    const result = run(args, childEnv);
    if (result.error || result.signal || result.status !== 0)
      throw new Error(
        `Wrangler阶段未成功完成；请核对本次日志${output}，不要盲目重试。`,
      );
  };
  call([
    "versions",
    "upload",
    "--config",
    generatedPath,
    "--strict",
    ...(dryRun ? ["--dry-run"] : ["--tag", commit]),
  ]);
  if (dryRun) return { dryRun: true };
  // Wrangler官方ND-JSON输出，不解析面向人的stdout，也不依靠同tag的其它构建。
  let records;
  try {
    records = readFileSync(output, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error("无法确认上传版本ID，未发出流量切换；请核对本次构建日志。");
  }
  const uploads = records.filter((record) => record.type === "version-upload");
  const version = uploads[0]?.version_id;
  if (
    uploads.length !== 1 ||
    uploads[0].worker_name !== name ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      version ?? "",
    )
  )
    throw new Error("上传版本ID或目标不明确，未发出流量切换。");
  // versions deploy会同步config内的observability等非版本设置，因此仅给它Worker名称。
  writeFileSync(promotion, JSON.stringify({ name }));
  call([
    "versions",
    "deploy",
    `${version}@100%`,
    "--config",
    promotion,
    "--yes",
  ]);
  const final = readFileSync(output, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.type === "version-deploy");
  if (
    final.length !== 1 ||
    final[0].worker_name !== name ||
    !final[0].deployment_id
  )
    throw new Error(
      `发布结果未获明确确认；上传版本${version}，请核对部署历史，勿自动重试。`,
    );
  return {
    dryRun: false,
    versionId: version,
    deploymentId: final[0].deployment_id,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        "只允许一个明确模式参数；离线验证请运行npm run verify:production。",
      );
    if (process.argv[2] === "--publish") await assertCurrentMain(process.env);
    process.env.WRANGLER_LOG_PATH ??= join(
      tmpdir(),
      "mademe-production-preflight.log",
    );
    const source = await readProductionSource();
    if (
      !existsSync(generatedPath) ||
      !existsSync(join(projectRoot, "dist/server/entry.mjs")) ||
      !existsSync(join(projectRoot, "dist/client"))
    )
      throw new Error("缺少构建产物，请先在production环境执行npm run build。");
    const result = runProductionDeploy({
      mode: process.argv[2],
      source,
      generated: JSON.parse(readFileSync(generatedPath, "utf8")),
    });
    console.log(
      result.dryRun
        ? "生产配置离线dry-run通过；未上传、未发布。"
        : `已发布本次上传版本${result.versionId}；deployment ${result.deploymentId}`,
    );
  } catch (error) {
    console.error(
      "生产部署停止：",
      error instanceof Error ? error.message : "未知错误",
    );
    process.exitCode = 1;
  }
}
