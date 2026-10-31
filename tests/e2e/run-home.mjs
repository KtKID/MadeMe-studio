import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/home-featured-grid.spec.ts",
    "tests/e2e/guest-smoke.spec.ts",
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
