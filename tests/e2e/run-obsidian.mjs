import { spawn } from "node:child_process";
// 使用项目已安装的 Playwright；不下载浏览器、不绕过系统 socket 限制。
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/obsidian-local.spec.ts",
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
