import { spawn } from "node:child_process";
import { DEV_PORT, SECOND_PORT, devOrigin } from "./dev-config.mjs";
import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wrangler = "node_modules/wrangler/bin/wrangler.js";
const startupTimeoutMs = 90_000;
const suiteTimeoutMs = 90_000;
const shutdownTimeoutMs = 5_000;
const logTailLimit = 16_384;

// 每次测试使用全新临时 D1/R2；只清理本次创建的目录和进程，不触碰开发数据。
export async function runLocalWorkerSuite({
  instances,
  testFile,
  suiteTimeout = suiteTimeoutMs,
}) {
  await access(new URL("../dist/server/wrangler.json", import.meta.url)).catch(
    () => {
      throw new Error("缺少构建产物，请先执行 npm run build。");
    },
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mademe-worker-test-"));
  const statePath = join(temporaryRoot, "state");
  const configHome = join(temporaryRoot, "config");
  await mkdir(configHome, { recursive: true });
  const children = [];
  let stopping = false;
  let rejectFailure;
  const failure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  // 防止准备阶段收到信号时出现尚未被 race 接管的拒绝。
  failure.catch(() => {});
  const onSignal = () =>
    rejectFailure(new Error("测试被中断，正在清理本地进程。"));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  function start(args, name, readyPort) {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        BASE_URL: devOrigin(DEV_PORT),
        SECOND_BASE_URL: devOrigin(SECOND_PORT),
        WRANGLER_LOG_PATH: join(temporaryRoot, `${name}.log`),
        XDG_CONFIG_HOME: configHome,
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => {});
    const exited = new Promise((resolve) => {
      child.once("error", (error) => {
        rejectReady(error);
        rejectFailure(error);
        resolve();
      });
      child.once("exit", (code, signal) => {
        resolve();
        if (!stopping && code !== 0) {
          const error = new Error(`${name} 退出：${code ?? signal}\n${tail}`);
          rejectReady(error);
          rejectFailure(error);
        } else if (!stopping && readyPort) {
          rejectFailure(new Error(`${name} 服务提前退出。\n${tail}`));
        }
        if (!readyPort) resolveReady();
      });
    });
    children.push({ child, exited });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (data) => {
        tail = (tail + data.toString()).slice(-logTailLimit);
        if (!readyPort) process.stdout.write(data);
        if (readyPort && tail.includes("Ready on")) {
          if (tail.includes(`http://127.0.0.1:${readyPort}`)) resolveReady();
          else
            rejectReady(
              new Error(
                `${name} 未在预期端口 ${readyPort} 启动，拒绝连接其他服务。\n${tail}`,
              ),
            );
        }
      });
    }
    return ready;
  }

  async function bounded(promise, timeoutMs, label) {
    let timer;
    try {
      await Promise.race([
        promise,
        failure,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label}超时。`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function signalChild(child, signal) {
    try {
      if (process.platform === "win32") child.kill(signal);
      else if (child.pid) process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH")
        console.error(`清理测试进程失败：${error.message}`);
    }
  }

  try {
    await bounded(
      start(
        [
          wrangler,
          "d1",
          "migrations",
          "apply",
          "DB",
          "--local",
          "--config",
          "wrangler.jsonc",
          "--persist-to",
          statePath,
        ],
        "migrations",
      ),
      startupTimeoutMs,
      "数据库迁移",
    );
    for (const { name, port, vars = [] } of instances) {
      await bounded(
        start(
          [
            wrangler,
            "dev",
            "--config",
            "dist/server/wrangler.json",
            "--local",
            "--ip",
            "127.0.0.1",
            "--port",
            String(port),
            "--persist-to",
            statePath,
            "--inspector-port",
            "0",
            ...vars.flatMap((value) => ["--var", value]),
          ],
          name,
          port,
        ),
        startupTimeoutMs,
        `${name} 启动`,
      );
    }
    await bounded(start([testFile], "suite"), suiteTimeout, "测试");
  } finally {
    stopping = true;
    for (const { child } of children) signalChild(child, "SIGTERM");
    let timer;
    await Promise.race([
      Promise.all(children.map(({ exited }) => exited)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, shutdownTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    // 同一进程组包含 Wrangler 启动的 workerd，避免留下子进程。
    for (const { child } of children) signalChild(child, "SIGKILL");
    await Promise.all(children.map(({ exited }) => exited));
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
