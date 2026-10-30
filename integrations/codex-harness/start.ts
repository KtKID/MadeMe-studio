import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startAppServer } from "./transport";
import { HarnessRunner } from "./runner";
import { HarnessRecorder } from "./recording";
import { createHarnessHTTP } from "./http";
import { HarnessError, safeError } from "./errors";
/** 不收紧既有目录权限；不安全目录直接拒绝，避免修改用户已有文件。 */
async function validatePrivateDirectory(path: string) {
  const info = await lstat(path);
  if (typeof process.getuid !== "function")
    throw new HarnessError(
      "UNSUPPORTED_HOST",
      "当前本地启动器仅支持可校验 Unix 目录权限的系统。",
    );
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o077) !== 0
  )
    throw new HarnessError(
      "UNSAFE_DIRECTORY_PERMISSIONS",
      "专用目录须归当前用户所有且权限为 0700；请自行选择或设置安全目录。",
    );
}
/** 仅显式命令入口。导入库、构建及测试都不触发真实 App Server 或网页登录。 */
export async function startLocalHarness(argv: string[]) {
  if (argv.includes("--help")) {
    process.stdout.write(
      "Usage: node dist/start.mjs --codex /absolute/codex --state-dir /absolute/dedicated-directory [--browser-login]\nOnly local open-source use; browser and runner must be on the same machine.\n",
    );
    return;
  }
  const allowed = new Set(["--codex", "--state-dir", "--browser-login"]);
  for (let i = 0; i < argv.length; i++) {
    if (!allowed.has(argv[i]))
      throw new HarnessError("INVALID_ARGUMENT", "未知启动参数。");
    if (argv[i] !== "--browser-login") i++;
  }
  const value = (flag: string) => argv[argv.indexOf(flag) + 1];
  if (!argv.includes("--codex") || !argv.includes("--state-dir"))
    throw new HarnessError(
      "HOST_CONFIG_REQUIRED",
      "必须显式提供 Codex 二进制及独立状态目录。",
    );
  const command = value("--codex"),
    state = value("--state-dir");
  if (!isAbsolute(command) || !isAbsolute(state))
    throw new HarnessError("INVALID_HOST_CONFIG", "启动路径必须为绝对路径。");
  await mkdir(state, { recursive: true, mode: 0o700 });
  await validatePrivateDirectory(state);
  if ((await lstat(state)).isSymbolicLink())
    throw new HarnessError("INVALID_HOST_CONFIG", "状态目录不能是符号链接。");
  const marker = join(state, ".local-harness");
  const entries = await readdir(state);
  if (entries.length) {
    let valid = false;
    try {
      valid =
        (await readFile(marker, "utf8")) === "local-open-source-harness-v1\n";
    } catch {}
    if (!valid)
      throw new HarnessError(
        "STATE_NOT_ISOLATED",
        "请选择空目录，不能复用个人 Codex 或其他应用的认证目录。",
      );
  } else
    await writeFile(marker, "local-open-source-harness-v1\n", {
      mode: 0o600,
      flag: "wx",
    });
  const home = join(state, "codex-home"),
    workspace = join(state, "tasks");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  for (const path of [home, workspace]) {
    await validatePrivateDirectory(path);
    if ((await lstat(path)).isSymbolicLink())
      throw new HarnessError("INVALID_HOST_CONFIG", "专用目录不能是符号链接。");
  }
  const rpc = () =>
    startAppServer({
      command,
      codexHome: home,
      workspaceRoot: workspace,
      path: process.env.PATH,
    });
  const runner = new HarnessRunner(rpc, {
    workspaceRoot: workspace,
    recorder: new HarnessRecorder(join(state, "recordings")),
    browserLoginAvailable: argv.includes("--browser-login"),
  });
  const pairCode = randomBytes(32).toString("base64url");
  const server = createHarnessHTTP(runner, {
    pairCode,
    pairExpiresAt: Date.now() + 5 * 60_000,
    consoleDirectory: join(dirname(fileURLToPath(import.meta.url)), "console"),
    audit: (event) => process.stderr.write(JSON.stringify(event) + "\n"),
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string")
      process.stdout.write(
        `Local one-time pairing (expires in 5 minutes): http://127.0.0.1:${address.port}/console#pair=${pairCode}\n`,
      );
  });
  const stop = () => {
    server.close();
    runner.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  void startLocalHarness(process.argv.slice(2)).catch((error) => {
    const safe = safeError(error);
    process.stderr.write(
      JSON.stringify({
        event: "harness.start.failed",
        code: safe.code,
        message: safe.message,
      }) + "\n",
    );
    process.exitCode = 1;
  });
