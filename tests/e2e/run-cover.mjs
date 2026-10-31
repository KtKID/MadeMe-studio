import { spawn } from "node:child_process";
// 使用项目已安装的 Playwright；浏览器可由 CHROMIUM_PATH 指定，不自动下载。
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/cover.spec.ts",
    "--workers=1",
  ],
  { stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
