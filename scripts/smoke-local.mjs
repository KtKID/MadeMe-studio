import { spawn } from "node:child_process";
// 在同一测试进程中启动隔离的本地 Worker，测试完成后关闭，不保留守护进程。
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "4321",
    "--inspector-port",
    "0",
  ],
  {
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: "/tmp/mademe-smoke-wrangler.log",
      XDG_CONFIG_HOME: "/tmp/mademe-config",
      WRANGLER_SEND_METRICS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let finished = false;
let running = false;
const timeout = setTimeout(() => finish(1, "本地服务启动超时"), 90000);
function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.kill("SIGTERM");
  if (message) console.log(message);
  process.exitCode = code;
}
async function test() {
  if (running) return;
  running = true;
  try {
    await import("../tests/smoke/http.mjs");
    finish(0);
  } catch (error) {
    finish(1, String(error));
  }
}
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => {
    const text = data.toString();
    if (text.includes("Ready on")) setTimeout(test, 500);
    if (text.includes("ERROR")) process.stderr.write(text);
  });
child.on("exit", (code) => {
  if (!finished) finish(1, `服务提前退出：${code}`);
});
